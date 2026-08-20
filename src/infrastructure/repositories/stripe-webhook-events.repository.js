const { HttpError } = require('../../core/http-error');

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

  async insertIfNew({ eventId, type, payloadSummary = null }) {
    this.ensureDataSource();
    const id = String(eventId || '').trim();
    if (!id) {
      throw new HttpError(400, 'Invalid Stripe event.', { code: 'invalid_stripe_event' });
    }

    try {
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`event_id\`, \`type\`, \`processed_at\`, \`payload_summary\`) VALUES (?, ?, CURRENT_TIMESTAMP, ?)`,
        [id, String(type || ''), payloadSummary ? JSON.stringify(payloadSummary) : null]
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

  async listEvents({ offset, perPage, type }) {
    this.ensureDataSource();
    const where = [];
    const params = [];
    if (type) {
      where.push('`type` = ?');
      params.push(String(type));
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
          `SELECT \`event_id\` AS eventId, \`type\`, \`processed_at\` AS processedAt, \`payload_summary\` AS payloadSummary`,
          `FROM \`${this.tableName}\``,
          whereSql,
          'ORDER BY `processed_at` DESC',
          'LIMIT ? OFFSET ?'
        ].join(' '),
        [...params, perPage, offset]
      );

      return {
        total,
        items: (Array.isArray(rows) ? rows : []).map((row) => ({
          id: String(row.eventId),
          eventId: String(row.eventId),
          eventType: String(row.type || ''),
          state: row.processedAt ? 'processed' : 'pending',
          attempts: row.processedAt ? 1 : 0,
          correlationId: null,
          createdAt: row.processedAt,
          processedAt: row.processedAt
        }))
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return { total: 0, items: [] };
      }
      throw error;
    }
  }
}

module.exports = {
  StripeWebhookEventsRepository
};
