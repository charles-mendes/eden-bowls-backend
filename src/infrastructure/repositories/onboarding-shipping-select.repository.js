const { HttpError } = require('../../core/http-error');

class OnboardingShippingSelectRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async selectShipping(userId, shipping) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`shipping\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`shipping\` = VALUES(\`shipping\`)`,
      [userId, JSON.stringify(shipping)]
    );

    return {
      shipping
    };
  }
}

module.exports = {
  OnboardingShippingSelectRepository
};
