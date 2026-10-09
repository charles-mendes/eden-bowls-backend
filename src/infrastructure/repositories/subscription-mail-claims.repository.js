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

function insertIdFromResult(result) {
  if (result && typeof result === 'object' && result.insertId != null) {
    return Number(result.insertId);
  }
  if (Array.isArray(result) && result[0] && result[0].insertId != null) {
    return Number(result[0].insertId);
  }
  return null;
}

class SubscriptionMailClaimsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'subscription_mail_claims';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async claimMailSend({ subscriptionId, template, referenceId }) {
    this.ensureDataSource();
    const subscription = String(subscriptionId || '').trim();
    const mailTemplate = String(template || '').trim();
    const reference = String(referenceId || '').trim();
    if (!subscription || !mailTemplate || !reference) {
      throw new HttpError(400, 'Mail claim is missing subscription, template or reference.');
    }

    try {
      const result = await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`stripe_subscription_id\`, \`template\`, \`reference_id\`, \`claimed_at\`, \`sent_at\`) VALUES (?, ?, ?, CURRENT_TIMESTAMP, NULL)`,
        [subscription, mailTemplate, reference]
      );
      return { claimed: true, id: insertIdFromResult(result) };
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        return { claimed: false };
      }
      if (isMissingTableError(error)) {
        throw new HttpError(503, 'Subscription mail claims table is not available.', {
          code: 'subscription_mail_claims_missing'
        });
      }
      throw error;
    }
  }

  async markSent(id) {
    this.ensureDataSource();
    const claimId = Number(id);
    if (!Number.isSafeInteger(claimId) || claimId <= 0) {
      return;
    }
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`sent_at\` = CURRENT_TIMESTAMP WHERE \`id\` = ? AND \`sent_at\` IS NULL`,
      [claimId]
    );
  }

  async releaseUnsent(id) {
    this.ensureDataSource();
    const claimId = Number(id);
    if (!Number.isSafeInteger(claimId) || claimId <= 0) {
      return;
    }
    await this.dataSource.query(
      `DELETE FROM \`${this.tableName}\` WHERE \`id\` = ? AND \`sent_at\` IS NULL`,
      [claimId]
    );
  }

  async hasSentClaim({ subscriptionId, template } = {}) {
    this.ensureDataSource();
    const subscription = String(subscriptionId || '').trim();
    const mailTemplate = String(template || '').trim();
    if (!subscription || !mailTemplate) {
      return false;
    }
    const rows = await this.dataSource.query(
      `SELECT \`id\` FROM \`${this.tableName}\` WHERE \`stripe_subscription_id\` = ? AND \`template\` = ? AND \`sent_at\` IS NOT NULL LIMIT 1`,
      [subscription, mailTemplate]
    );
    return Array.isArray(rows) && rows.length > 0;
  }

  async savePayload(id, payload) {
    this.ensureDataSource();
    const claimId = Number(id);
    if (!Number.isSafeInteger(claimId) || claimId <= 0) {
      return;
    }
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`payload\` = ? WHERE \`id\` = ? AND \`sent_at\` IS NULL`,
      [JSON.stringify(payload), claimId]
    );
  }

  async recordSendFailure(id, error) {
    this.ensureDataSource();
    const claimId = Number(id);
    if (!Number.isSafeInteger(claimId) || claimId <= 0) {
      return { attempts: 0, exhausted: false };
    }
    const message = String(error && error.message ? error.message : 'smtp_failed').slice(0, 500);
    await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`attempts\` = \`attempts\` + 1, \`last_error\` = ?, \`exhausted_at\` = CASE WHEN \`attempts\` + 1 >= 5 THEN CURRENT_TIMESTAMP ELSE \`exhausted_at\` END WHERE \`id\` = ? AND \`sent_at\` IS NULL AND \`exhausted_at\` IS NULL`,
      [message, claimId]
    );
    const rows = await this.dataSource.query(
      `SELECT \`attempts\`, \`exhausted_at\` AS exhaustedAt FROM \`${this.tableName}\` WHERE \`id\` = ?`,
      [claimId]
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return {
      attempts: Number(row && row.attempts) || 0,
      exhausted: Boolean(row && row.exhaustedAt)
    };
  }

  async listResendable({ olderThan, limit = 20, templates = [] } = {}) {
    this.ensureDataSource();
    const names = (Array.isArray(templates) ? templates : []).map((item) => String(item)).filter(Boolean);
    if (!names.length) {
      return [];
    }
    const placeholders = names.map(() => '?').join(', ');
    const rows = await this.dataSource.query(
      [
        'SELECT `id`, `template`, `payload`, `attempts`, `sent_at` AS sentAt, `claimed_at` AS claimedAt',
        `FROM \`${this.tableName}\``,
        `WHERE \`sent_at\` IS NULL AND \`exhausted_at\` IS NULL AND \`claimed_at\` <= ? AND \`template\` IN (${placeholders})`,
        'ORDER BY `claimed_at` ASC',
        'LIMIT ?'
      ].join(' '),
      [olderThan, ...names, limit]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      id: Number(row.id),
      template: String(row.template || ''),
      attempts: Number(row.attempts || 0),
      sentAt: row.sentAt,
      claimedAt: row.claimedAt,
      payload: parsePayload(row.payload)
    }));
  }
}

function parsePayload(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

module.exports = {
  SubscriptionMailClaimsRepository
};
