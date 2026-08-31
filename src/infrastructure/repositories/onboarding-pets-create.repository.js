const { HttpError } = require('../../core/http-error');

class OnboardingPetCreateRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_pets';
  }

  async createPet(userId, petId, payload = {}) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`id\`, \`user_id\`, \`name\`, \`breed\`, \`age_years\`, \`age_months\`, \`weight_input\`, \`weight_unit\`, \`size\`, \`activity_level\`, \`pet_condition\`, \`neutered\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        petId,
        userId,
        payload.name,
        payload.breed,
        payload.age_years,
        payload.age_months,
        payload.weight,
        payload.weight_unit,
        payload.size,
        payload.activity_level,
        payload.pet_condition,
        payload.neutered ? 1 : 0
      ]
    );

    return {
      pet: {
        id: petId,
        name: payload.name,
        breed: payload.breed,
        age_years: payload.age_years,
        age_months: payload.age_months,
        age: payload.age_years,
        weight_input: payload.weight,
        weight_unit: payload.weight_unit,
        weight: payload.weight,
        size: payload.size,
        activity_level: payload.activity_level,
        pet_condition: payload.pet_condition,
        neutered: payload.neutered,
        image_url: ''
      }
    };
  }

  async syncPets(userId, pets = []) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const results = [];
    for (const payload of pets) {
      const petId = payload.pet_id || require('crypto').randomUUID();
      const localId = payload.local_id || payload.pet_id || petId;
      await this.dataSource.query(
        `INSERT INTO \`${this.tableName}\` (\`id\`, \`user_id\`, \`local_id\`, \`name\`, \`breed\`, \`age_years\`, \`age_months\`, \`weight_input\`, \`weight_unit\`, \`size\`, \`activity_level\`, \`pet_condition\`, \`neutered\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE \`name\` = VALUES(\`name\`), \`breed\` = VALUES(\`breed\`), \`age_years\` = VALUES(\`age_years\`), \`age_months\` = VALUES(\`age_months\`), \`weight_input\` = VALUES(\`weight_input\`), \`weight_unit\` = VALUES(\`weight_unit\`), \`size\` = VALUES(\`size\`), \`activity_level\` = VALUES(\`activity_level\`), \`pet_condition\` = VALUES(\`pet_condition\`), \`neutered\` = VALUES(\`neutered\`), \`deleted_at\` = NULL`,
        [
          petId,
          userId,
          localId,
          payload.name,
          payload.breed || '',
          Number(payload.age_years || 0),
          Number(payload.age_months || 0),
          Number(payload.weight || 0),
          payload.weight_unit || 'kg',
          payload.size || 'medium',
          payload.activity_level || 'medium',
          payload.pet_condition || 'ideal',
          payload.neutered ? 1 : 0
        ]
      );
      results.push({ local_id: localId, id: petId });
    }

    return { pets: results };
  }
}

module.exports = {
  OnboardingPetCreateRepository
};
