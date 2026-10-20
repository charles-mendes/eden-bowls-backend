const { HttpError } = require('../core/http-error');
const { marketFromStripeAccount } = require('./life-stage.service');

class SubscriptionsDetailService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.lifeStageService = options.lifeStageService || null;
    this.petsRepository = options.petsRepository || null;
    this.lifeStageNoticesService = options.lifeStageNoticesService || null;
    this.ledgerRepository = options.ledgerRepository || null;
  }

  async getDetail({ subscriptionId, userId }) {
    if (!this.repository) {
      throw new HttpError(503, 'Subscriptions detail repository is not available.');
    }

    if (!subscriptionId || !/^sub_[A-Za-z0-9]+$/.test(subscriptionId)) {
      throw new HttpError(422, 'Invalid subscription id.', { code: 'invalid_subscription_id' });
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const data = await this.repository.getDetail(userId, subscriptionId);
    if (!data || !data.subscription) {
      throw new HttpError(404, 'Subscription not found.', { code: 'subscription_not_found' });
    }

    const pets = data.subscription.pets;
    if (this.lifeStageNoticesService && this.ledgerRepository && Array.isArray(pets) && pets.length > 0) {
      const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
      const report = row ? (await this.lifeStageNoticesService.reportForUser(userId, [row])).get(row.id) || [] : [];
      const byPet = new Map(report.map((entry) => [entry.pet_id, entry]));
      data.subscription.pets = pets.map((pet) => {
        const entry = byPet.get(String(pet.id || pet.pet_id || ''));
        return entry ? { ...pet, ...entry } : pet;
      });
    } else if (this.lifeStageService && Array.isArray(pets) && pets.length > 0) {
      const market = marketFromStripeAccount(data.subscription.stripe_account);
      const stages = await this.lifeStageService.stagesById(this.petsRepository, userId, market);
      data.subscription.pets = pets.map((pet) => {
        const stage = stages.get(String(pet.id || pet.pet_id || ''));
        return stage ? { ...pet, ...stage } : pet;
      });
    }

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  SubscriptionsDetailService
};
