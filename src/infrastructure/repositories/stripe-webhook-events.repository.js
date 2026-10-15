const { HttpError } = require('../../core/http-error');
const { appendInFilter } = require('../../core/admin-market-scope');

function isDuplicateKeyError(error) {
  return Boolean(error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062));
}

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(
    error && (
      error.code === 'ER_NO_SUCH_TABLE' ||
      error.errno === 1146 ||
      /doesn't exist/i.test(message)
    )
  );
}

class StripeWebhookEventsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'stripe_webhook_events';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async insertIfNew({ eventId, stripeAccount = 'us', type, payloadSummary = null }) {
    this.ensureDataSource();
    const id = String(eventId || '').trim();
    if (!id) {
      throw new HttpError(400, 'Invalid Stripe event.', { code: 'invalid_stripe_event' });
    }

    const account = String(stripeAccount || 'us').trim().toLowerCase() || 'us';

    try {
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`event_id\`, \`stripe_account\`, \`type\`, \`processed_at\`, \`payload_summary\`, \`attempts\`, \`next_attempt_at\`, \`created_at\`) VALUES (?, ?, ?, NULL, ?, 0, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 SECOND), CURRENT_TIMESTAMP)`,
        [id, account, String(type || ''), payloadSummary ? JSON.stringify(payloadSummary) : null]
      );
      return { inserted: true };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return { inserted: false };
      }
      if (isMissingTableError(error)) {
        throw new HttpError(503, 'Stripe webhook events table is not available.', {
          code: 'stripe_webhook_events_missing'
        });
      }
      throw error;
    }
  }

  async listEvents({ offset, perPage, type, stripeAccounts }) {
    this.ensureDataSource();
    const where = [];
    const params = [];
    if (type) {
      where.push('`type` = ?');
      params.push(String(type));
    }
    if (Array.isArray(stripeAccounts) && stripeAccounts.length) {
      appendInFilter(where, params, '`stripe_account`', stripeAccounts);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    try {
      const countRows = await this.dataSource.query(
        `SELECT COUNT(*) AS total FROM \`${this.tableName}\` ${whereSql}`,
        params
      );
      const total = Number(Array.isArray(countRows) && countRows[0] ? countRows[0].total : 0);
      const rows = await this.dataSource.query(
        [
          'SELECT `event_id` AS eventId, `stripe_account` AS stripeAccount, `type`, `processed_at` AS processedAt, `failed_at` AS failedAt, `attempts`, `created_at` AS createdAt, `payload_summary` AS payloadSummary',
          `FROM \`${this.tableName}\``,
          whereSql,
          'ORDER BY COALESCE(`created_at`, `processed_at`) DESC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, perPage, offset]
      );

      return {
        total,
        items: (Array.isArray(rows) ? rows : []).map((row) => this.mapEvent(row))
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }

  async listDue({ limit = 20, now = new Date() } = {}) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      [
        'SELECT `event_id` AS eventId, `stripe_account` AS stripeAccount, `type`, `attempts`, `created_at` AS createdAt, `next_attempt_at` AS nextAttemptAt',
        `FROM \`${this.tableName}\``,
        'WHERE `processed_at` IS NULL AND `failed_at` IS NULL AND (`next_attempt_at` IS NULL OR `next_attempt_at` <= ?)',
        'ORDER BY `created_at` ASC',
        'LIMIT ?'
      ].join(' '),
      [now, limit]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      eventId: String(row.eventId),
      stripeAccount: String(row.stripeAccount || 'us'),
      type: String(row.type || ''),
      attempts: Number(row.attempts || 0),
      createdAt: row.createdAt,
      nextAttemptAt: row.nextAttemptAt
    }));
  }

  async markProcessed({ eventId, stripeAccount }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`processed_at\` = CURRENT_TIMESTAMP WHERE \`event_id\` = ? AND \`stripe_account\` = ? AND \`processed_at\` IS NULL`,
      [String(eventId), String(stripeAccount || 'us')]
    );
  }

  async scheduleRetry({ eventId, stripeAccount, attempts, lastError, nextAttemptAt }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`attempts\` = ?, \`last_error\` = ?, \`next_attempt_at\` = ? WHERE \`event_id\` = ? AND \`stripe_account\` = ? AND \`processed_at\` IS NULL AND \`failed_at\` IS NULL`,
      [
        Number(attempts) || 0,
        String(lastError || '').slice(0, 500),
        nextAttemptAt,
        String(eventId),
        String(stripeAccount || 'us')
      ]
    );
  }

  async markFailed({ eventId, stripeAccount, attempts, lastError }) {
    this.ensureDataSource();
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`attempts\` = ?, \`last_error\` = ?, \`failed_at\` = CURRENT_TIMESTAMP, \`next_attempt_at\` = NULL WHERE \`event_id\` = ? AND \`stripe_account\` = ? AND \`processed_at\` IS NULL`,
      [
        Number(attempts) || 0,
        String(lastError || '').slice(0, 500),
        String(eventId),
        String(stripeAccount || 'us')
      ]
    );
  }

  // Per Stripe account: newest receipt and its type, failures since `failedSince`, and events
  // received before `overdueBefore` that are still neither processed nor failed.
  async healthByAccount({ failedSince, overdueBefore }) {
    this.ensureDataSource();
    try {
      const totals = await this.dataSource.query(
        [
          'SELECT `stripe_account` AS account, MAX(`created_at`) AS lastEventAt,',
          'SUM(CASE WHEN `failed_at` >= ? THEN 1 ELSE 0 END) AS failedLast24h,',
          'SUM(CASE WHEN `processed_at` IS NULL AND `failed_at` IS NULL AND `created_at` < ? THEN 1 ELSE 0 END) AS pendingOverdue',
          `FROM \`${this.tableName}\``,
          'GROUP BY `stripe_account`'
        ].join(' '),
        [failedSince, overdueBefore]
      );
      const newest = await this.dataSource.query(
        [
          'SELECT e.`stripe_account` AS account, e.`type` AS type',
          `FROM \`${this.tableName}\` e`,
          `INNER JOIN (SELECT \`stripe_account\`, MAX(\`created_at\`) AS newest FROM \`${this.tableName}\` GROUP BY \`stripe_account\`) latest`,
          'ON latest.`stripe_account` = e.`stripe_account` AND latest.newest = e.`created_at`',
          'ORDER BY e.`event_id` DESC'
        ].join(' ')
      );
      const typeByAccount = new Map();
      for (const row of Array.isArray(newest) ? newest : []) {
        if (!typeByAccount.has(row.account)) {
          typeByAccount.set(row.account, row.type);
        }
      }

      return (Array.isArray(totals) ? totals : []).map((row) => ({
        account: String(row.account || '').toLowerCase(),
        lastEventAt: row.lastEventAt,
        lastEventType: typeByAccount.get(row.account) || null,
        failedLast24h: Number(row.failedLast24h || 0),
        pendingOverdue: Number(row.pendingOverdue || 0)
      }));
    } catch (error) {
      if (isMissingTableError(error)) {
        return [];
      }
      throw error;
    }
  }

  async deleteProcessedBefore(cutoff) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `DELETE FROM \`${this.tableName}\` WHERE \`processed_at\` IS NOT NULL AND \`failed_at\` IS NULL AND \`processed_at\` < ?`,
      [cutoff]
    );
    if (result && typeof result.affectedRows === 'number') {
      return result.affectedRows;
    }
    return 0;
  }

  mapEvent(row) {
    let state = 'pending';
    if (row.failedAt) {
      state = 'failed';
    } else if (row.processedAt) {
      state = 'processed';
    }

    return {
      id: String(row.eventId),
      eventId: String(row.eventId),
      stripeAccount: String(row.stripeAccount || 'us'),
      eventType: String(row.type || ''),
      state,
      attempts: Number(row.attempts || 0),
      correlationId: null,
      createdAt: row.createdAt || row.processedAt,
      processedAt: row.processedAt
    };
  }
}

module.exports = {
  StripeWebhookEventsRepository
};
