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
}

module.exports = {
  SubscriptionMailClaimsRepository
};
