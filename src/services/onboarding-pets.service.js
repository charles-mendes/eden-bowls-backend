const { HttpError } = require('../core/http-error');
const { MARKETS, formatPetForMarket } = require('../core/market');

class OnboardingPetsService {
  constructor(repository) {
    this.repository = repository;
  }

  async listPets({ userId, market = MARKETS.US }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pets repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.listPets(userId);
    const pets = Array.isArray(data.pets) ? data.pets.map((pet) => formatPetForMarket(pet, market)) : [];

    return {
      success: true,
      data: {
        country: market.country,
        currency: market.currency,
        pets
      }
    };
  }
}

module.exports = {
  OnboardingPetsService
};
