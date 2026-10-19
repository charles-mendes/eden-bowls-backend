const { HttpError } = require('../core/http-error');
const { marketFromStripeAccount } = require('./life-stage.service');

class SubscriptionsService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.lifeStageService = options.lifeStageService || null;
    this.petsRepository = options.petsRepository || null;
  }

  // Each subscription lists the stage of its pets, read from the account pets of its market.
  async withLifeStages(userId, subscriptions) {
    if (!this.lifeStageService || !Array.isArray(subscriptions) || subscriptions.length === 0) {
      return subscriptions;
    }
    const byMarket = new Map();
    const result = [];
    for (const subscription of subscriptions) {
      const market = marketFromStripeAccount(subscription.stripe_account);
      if (!byMarket.has(market)) {
        byMarket.set(market, await this.lifeStageService.stagesById(this.petsRepository, userId, market));
      }
      const stages = byMarket.get(market);
      const petIds = Array.isArray(subscription.pet_ids) ? subscription.pet_ids : [];
      result.push({
        ...subscription,
        pet_life_stages: petIds
          .filter((id) => stages.has(String(id)))
          .map((id) => ({ pet_id: String(id), ...stages.get(String(id)) }))
      });
    }
    return result;
  }

  async listMine({ userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.listMine({ userId });
    const subscriptions = await this.withLifeStages(userId, data && data.subscriptions);

    return {
      success: true,
      data: { ...data, subscriptions }
    };
  }
}

module.exports = {
  SubscriptionsService
};
