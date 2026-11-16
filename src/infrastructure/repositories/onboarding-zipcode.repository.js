const { HttpError } = require('../../core/http-error');
const { canonicalMarketFromCountry } = require('../../core/admin-market-scope');

class OnboardingZipcodeRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  // The saved address JSON, or null when the user has none yet.
  async getAddress(userId) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
    const rows = await this.dataSource.query(
      `SELECT \`address\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const raw = Array.isArray(rows) && rows[0] ? rows[0].address : null;
    if (!raw) return null;
    if (typeof raw === 'object') return raw;
    try {
      const parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_error) {
      return null;
    }
  }

  async saveZipcode(userId, payload = {}) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    // Other steps (plan, recurrence, shipping, checkout) may create the row first without a market, so the
    // first address fills it when empty; a later address never moves the checkout to another market.
    const market = canonicalMarketFromCountry(payload.country);
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`address\`, \`market\`) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE \`address\` = VALUES(\`address\`), \`market\` = COALESCE(NULLIF(\`market\`, ''), VALUES(\`market\`))`,
      [userId, JSON.stringify(payload), market]
    );

    return {
      zipcode: payload
    };
  }
}

module.exports = {
  OnboardingZipcodeRepository
};
