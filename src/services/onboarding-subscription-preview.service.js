const { HttpError } = require('../core/http-error');

function normalizePriceIds(payload = {}, fallback = []) {
  const explicit = Array.isArray(payload.price_ids) ? payload.price_ids : [];
  const normalized = explicit.filter((item) => typeof item === 'string' && item.startsWith('price_'));

  if (normalized.length > 0) {
    return normalized;
  }

  return fallback.filter((item) => typeof item === 'string' && item.startsWith('price_'));
}

function normalizeAddress(payload = {}) {
  const address = payload.address || {};
  const country = String(address.country || '').trim().toUpperCase();
  const state = String(address.state || '').trim();
  const postalCode = String(address.postal_code || address.postalCode || address.zipcode || address.postcode || '').trim();

  return {
    country,
    state,
    postal_code: postalCode,
    line1: String(address.line1 || '').trim(),
    city: String(address.city || '').trim()
  };
}

class OnboardingSubscriptionPreviewService {
  constructor(repository) {
    this.repository = repository;
  }

  async preview({ userId, payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding subscription preview repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const address = normalizeAddress(payload);
    if (address.country !== 'US') {
      throw new HttpError(400, 'Preview is only available for US addresses.', { code: 'preview_us_only' });
    }

    const fallbackPriceIds = (this.repository.getFallbackPriceIds && await this.repository.getFallbackPriceIds(userId)) || [];
    const priceIds = normalizePriceIds(payload, fallbackPriceIds);

    if (priceIds.length === 0) {
      throw new HttpError(422, 'At least one valid price id is required.', { code: 'invalid_price_id' });
    }

    const data = await this.repository.preview({ address, priceIds });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingSubscriptionPreviewService,
  normalizeAddress,
  normalizePriceIds
};
