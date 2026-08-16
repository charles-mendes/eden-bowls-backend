const { HttpError } = require('../core/http-error');
const crypto = require('crypto');
const { MARKETS, formatPetForMarket } = require('../core/market');

class OnboardingPetCreateService {
  constructor(repository) {
    this.repository = repository;
  }

  async createPet({ userId, payload, market = MARKETS.US }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding pet create repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const result = await this.repository.createPet(userId, crypto.randomUUID(), payload);

    return {
      success: true,
      data: {
        country: market.country,
        pet: formatPetForMarket(result.pet, market)
      }
    };
  }
}

module.exports = {
  OnboardingPetCreateService
};
