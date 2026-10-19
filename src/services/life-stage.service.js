const { resolveLifeStage } = require('../core/life-stage');

// The single source of a dog's stage: every API payload asks this service, never the client.
class LifeStageService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.now = options.now || (() => new Date());
  }

  async resolve(pet, market) {
    const { limits, breedClasses } = await this.repository.forMarket(market);
    return resolveLifeStage(pet || {}, { limits, breedClasses, now: this.now() });
  }

  async resolveMany(pets, market) {
    const { limits, breedClasses } = await this.repository.forMarket(market);
    const now = this.now();
    return (Array.isArray(pets) ? pets : []).map((pet) => resolveLifeStage(pet || {}, { limits, breedClasses, now }));
  }
}

module.exports = {
  LifeStageService
};
