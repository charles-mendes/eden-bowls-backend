const { HttpError } = require('../core/http-error');
const { MARKETS, formatPetForMarket } = require('../core/market');

class OnboardingPetUpdateService {
  constructor(repository) {
    this.repository = repository;
  }

  async updatePet({ userId, petId, payload, market = MARKETS.US }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet update repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const pet = await this.repository.updatePet(userId, petId, payload);
    if (!pet) {
      throw new HttpError(404, 'Pet not found.', { code: 'pet_not_found' });
    }

    return {
      success: true,
      data: {
        country: market.country,
        pet: formatPetForMarket(pet, market)
      }
    };
  }
}

module.exports = {
  OnboardingPetUpdateService
};
