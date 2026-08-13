const { HttpError } = require('../../core/http-error');

class OnboardingRecurrenceRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async setRecurrence(userId, recurrence) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const updatedAt = new Date().toISOString();
    const value = {
      frequency: recurrence.frequency,
      period_days: recurrence.periodDays,
      updated_at: updatedAt
    };
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`user_id\`, \`recurrence\`) VALUES (?, ?) ON DUPLICATE KEY UPDATE \`recurrence\` = VALUES(\`recurrence\`)`,
      [userId, JSON.stringify(value)]
    );

    return {
      recurrence: value
    };
  }
}

module.exports = {
  OnboardingRecurrenceRepository
};
