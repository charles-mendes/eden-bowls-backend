const { HttpError } = require('../../core/http-error');

class OnboardingPlanSelectionRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async setPlanSelection(userId, payload = {}) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const planSelection = {
      ...payload,
      updated_at: new Date().toISOString()
    };
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`plan_selection\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`plan_selection\` = VALUES(\`plan_selection\`)`,
      [userId, JSON.stringify(planSelection)]
    );

    return {
      plan_selection: planSelection
    };
  }
}

module.exports = {
  OnboardingPlanSelectionRepository
};
