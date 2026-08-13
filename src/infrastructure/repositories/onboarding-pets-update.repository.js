const { HttpError } = require('../../core/http-error');

class OnboardingPetUpdateRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_pets';
  }

  async updatePet(userId, petId, payload = {}) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const fieldMap = {
      name: 'name',
      breed: 'breed',
      age_years: 'age_years',
      age_months: 'age_months',
      weight: 'weight_input',
      weight_unit: 'weight_unit',
      size: 'size',
      activity_level: 'activity_level',
      pet_condition: 'pet_condition',
      neutered: 'neutered'
    };
    const updates = Object.entries(fieldMap)
      .filter(([key]) => payload[key] !== undefined)
      .map(([key, column]) => ({ column, value: key === 'neutered' ? (payload[key] ? 1 : 0) : payload[key] }));

    if (updates.length === 0) {
      return this.findPet(userId, petId);
    }

    const result = await this.dataSource.query(
      `UPDATE \`${this.tableName}\` SET ${updates.map(({ column }) => `\`${column}\` = ?`).join(', ')} WHERE \`id\` = ? AND \`user_id\` = ? AND \`deleted_at\` IS NULL`,
      [...updates.map(({ value }) => value), petId, userId]
    );
    if (this.getAffectedRows(result) !== 1) {
      return null;
    }

    return this.findPet(userId, petId);
  }

  async findPet(userId, petId) {
    const rows = await this.dataSource.query(
      `SELECT \`id\`, \`name\`, \`breed\`, \`age_years\`, \`age_months\`, \`weight_input\`, \`weight_unit\`, \`size\`, \`activity_level\`, \`pet_condition\`, \`neutered\`, \`image_url\` FROM \`${this.tableName}\` WHERE \`id\` = ? AND \`user_id\` = ? AND \`deleted_at\` IS NULL LIMIT 1`,
      [petId, userId]
    );
    const pet = Array.isArray(rows) ? rows[0] : null;
    if (!pet) {
      return null;
    }

    return {
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
    };
  }

  getAffectedRows(result) {
    return result && typeof result.affectedRows === 'number' ? result.affectedRows : 0;
  }
}

module.exports = {
  OnboardingPetUpdateRepository
};
