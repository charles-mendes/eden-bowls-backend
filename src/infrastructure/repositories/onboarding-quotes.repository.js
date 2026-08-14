const { HttpError } = require('../../core/http-error');

class OnboardingQuotesRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_quotes';
  }

  assertDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async createQuote({ id, userId = null, payloadHash, payload, pricing, expiresAt }) {
    this.assertDataSource();

    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`id\`, \`user_id\`, \`payload_hash\`, \`payload\`, \`pricing\`, \`status\`, \`expires_at\`) VALUES (?, ?, ?, ?, ?, 'active', ?)`,
      [id, userId, payloadHash, JSON.stringify(payload), JSON.stringify(pricing), expiresAt]
    );

    return { id, payload_hash: payloadHash, pricing, status: 'active', expires_at: expiresAt };
  }

  async findActiveQuote(id, now = new Date()) {
    this.assertDataSource();

    const rows = await this.dataSource.query(
      `SELECT \`id\`, \`user_id\`, \`payload_hash\`, \`payload\`, \`pricing\`, \`status\`, \`expires_at\`, \`consumed_at\` FROM \`${this.tableName}\` WHERE \`id\` = ? AND \`status\` = 'active' AND \`expires_at\` > ? LIMIT 1`,
      [id, now]
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  async consumeQuote(id, now = new Date()) {
    this.assertDataSource();

    const result = await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`status\` = 'consumed', \`consumed_at\` = ? WHERE \`id\` = ? AND \`status\` = 'active' AND \`expires_at\` > ?`,
      [now, id, now]
    );
    return Boolean(result && result.affectedRows === 1);
  }
}

module.exports = {
  OnboardingQuotesRepository
};