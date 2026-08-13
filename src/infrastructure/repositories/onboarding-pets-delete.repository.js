const { HttpError } = require('../../core/http-error');

class OnboardingPetDeleteRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_pets';
  }

  async deletePet(userId, petId, deletedAt) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const result = await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET \`deleted_at\` = ? WHERE \`id\` = ? AND \`user_id\` = ? AND \`deleted_at\` IS NULL`,
      [deletedAt, petId, userId]
    );

    if (!result || result.affectedRows !== 1) {
      return null;
    }

    return {
      removed_pet: {
        id: petId,
        deleted_at: deletedAt,
        deleted_by_user_id: userId,
        deleted_reason: 'user_request'
      }
    };
  }
}

module.exports = {
  OnboardingPetDeleteRepository
};
