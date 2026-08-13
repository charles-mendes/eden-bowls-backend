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
}

module.exports = {
  OnboardingPetCreateRepository
};
