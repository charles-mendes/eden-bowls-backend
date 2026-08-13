const { HttpError } = require('../../core/http-error');

class OnboardingZipcodeRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async saveZipcode(userId, payload = {}) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`address\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`address\` = VALUES(\`address\`)`,
      [userId, JSON.stringify(payload)]
    );

    return {
      zipcode: payload
    };
  }
}

module.exports = {
  OnboardingZipcodeRepository
};
