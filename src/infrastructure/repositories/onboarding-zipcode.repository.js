const { HttpError } = require('../../core/http-error');
const { canonicalMarketFromCountry } = require('../../core/admin-market-scope');

class OnboardingZipcodeRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
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
