const { HttpError } = require('../../core/http-error');

// History of every age or birth-date change of a pet (L-21).
class PetAgeChangesRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'pet_age_changes';
  }

  async record(change) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\`
        (pet_id, user_id, old_age_years, old_age_months, old_birth_date, new_age_years, new_age_months, new_birth_date,
         old_life_stage, new_life_stage, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        change.petId,
        change.userId,
        change.oldAgeYears,
        change.oldAgeMonths,
        change.oldBirthDate || null,
        change.newAgeYears,
        change.newAgeMonths,
        change.newBirthDate || null,
        change.oldLifeStage || null,
        change.newLifeStage || null,
        change.source
      ]
    );
  }
}

module.exports = {
  PetAgeChangesRepository
};
