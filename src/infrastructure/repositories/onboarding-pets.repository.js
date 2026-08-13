const { HttpError } = require('../../core/http-error');

class OnboardingPetsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_pets';
  }

  async listPets(userId) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const sql = [
      'SELECT `id`, `name`, `breed`, `age_years`, `age_months`, `weight_input`, `weight_unit`,',
      '`size`, `activity_level`, `pet_condition`, `neutered`, `image_url`',
      `FROM \`${this.tableName}\``,
      'WHERE `user_id` = ? AND `deleted_at` IS NULL',
      'ORDER BY `created_at` ASC'
    ].join(' ');
    const rows = await this.dataSource.query(sql, [userId]);

    return {
      pets: (Array.isArray(rows) ? rows : []).map((pet) => ({
        id: String(pet.id),
        name: String(pet.name || ''),
        breed: String(pet.breed || ''),
        age_years: Number(pet.age_years || 0),
        age_months: Number(pet.age_months || 0),
        age: Number(pet.age_years || 0),
        weight_input: Number(pet.weight_input || 0),
        weight_unit: pet.weight_unit === 'lb' ? 'lb' : 'kg',
        weight: Number(pet.weight_input || 0),
        size: String(pet.size || ''),
        activity_level: String(pet.activity_level || ''),
        pet_condition: String(pet.pet_condition || ''),
        neutered: Boolean(pet.neutered),
        image_url: String(pet.image_url || '')
      }))
    };
  }
}

module.exports = {
  OnboardingPetsRepository
};
