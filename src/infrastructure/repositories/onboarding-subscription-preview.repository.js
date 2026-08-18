const { HttpError } = require('../../core/http-error');
const { collectPriceItems } = require('../../core/checkout-state');

function parseJsonColumn(value) {
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

class OnboardingSubscriptionPreviewRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
    this.stripeBilling = options.stripeBilling || null;
  }

  async getFallbackPriceIds(userId) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const rows = await this.dataSource.query(
      `SELECT \`plan_selection\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const planSelection = parseJsonColumn(Array.isArray(rows) && rows[0] ? rows[0].plan_selection : null);
    const fromItems = collectPriceItems(planSelection || {})
      .map((item) => item.price)
      .filter((priceId) => typeof priceId === 'string' && priceId.startsWith('price_'));

    if (fromItems.length > 0) {
      return fromItems;
    }

    const pets = Array.isArray(planSelection && planSelection.pets) ? planSelection.pets : [];
    return pets.flatMap((pet) => Array.isArray(pet.price_ids) ? pet.price_ids : [])
      .filter((priceId) => typeof priceId === 'string' && priceId.startsWith('price_'));
  }

  async preview(payload = {}) {
    if (!this.stripeBilling) {
      throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', { code: 'stripe_secret_missing' });
    }

    const items = (Array.isArray(payload.priceIds) ? payload.priceIds : [])
      .filter((priceId) => typeof priceId === 'string' && priceId.startsWith('price_'))
      .map((price) => ({ price, quantity: 1 }));

    if (items.length === 0) {
      throw new HttpError(422, 'At least one valid price id is required.', { code: 'invalid_price_id' });
    }

    return this.stripeBilling.previewSubscriptionInvoice({
      address: payload.address || {},
      items
    });
  }
}

module.exports = {
  OnboardingSubscriptionPreviewRepository
};
