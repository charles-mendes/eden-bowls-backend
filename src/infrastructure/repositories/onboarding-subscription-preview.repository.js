const { HttpError } = require('../../core/http-error');

class OnboardingSubscriptionPreviewRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async getFallbackPriceIds(userId) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const rows = await this.dataSource.query(
      `SELECT \`plan_selection\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const rawPlanSelection = Array.isArray(rows) && rows[0] ? rows[0].plan_selection : null;
    const planSelection = this.parseJson(rawPlanSelection);
    const pets = Array.isArray(planSelection && planSelection.pets) ? planSelection.pets : [];

    return pets.flatMap((pet) => Array.isArray(pet.price_ids) ? pet.price_ids : [])
      .filter((priceId) => typeof priceId === 'string' && priceId.startsWith('price_'));
  }

  async preview(payload = {}) {
    return {
      subtotal: 25,
      tax: 2.5,
      total: 27.5,
      currency: 'usd'
    };
  }

  parseJson(value) {
    if (!value) {
      return null;
    }

    if (typeof value === 'object') {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
}

module.exports = {
  OnboardingSubscriptionPreviewRepository
};
