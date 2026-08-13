const { HttpError } = require('../core/http-error');

function normalizeNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function normalizeShippingPayload(payload = {}) {
  const rateId = String(payload.rate_id || payload.method_id || '').trim();
  const methodId = String(payload.method_id || '').trim();
  const label = String(payload.label || 'Shipping').trim();
  const cost = normalizeNonNegativeNumber(payload.cost, 0);
  const taxTotal = normalizeNonNegativeNumber(payload.tax_total, 0);
  const total = normalizeNonNegativeNumber(payload.total, cost + taxTotal);
  const instanceId = normalizeNonNegativeNumber(payload.instance_id, 0);
  const transitBusinessDays = normalizeNonNegativeNumber(payload.transit_business_days, 0);
  const deliveryDays = normalizeNonNegativeNumber(payload.delivery_days, transitBusinessDays);
  const distance = normalizeNonNegativeNumber(payload.distance, 0);
  const perKm = normalizeNonNegativeNumber(payload.per_km, 0);
  const zipcode = String(payload.zipcode || '').trim();

  if (!rateId && !methodId) {
    throw new HttpError(422, 'Shipping selection is invalid.', { code: 'invalid_shipping' });
  }

  return {
    rate_id: rateId || methodId,
    method_id: methodId || rateId,
    instance_id: instanceId,
    label,
    cost,
    tax_total: taxTotal,
    total,
    transit_business_days: transitBusinessDays,
    delivery_days: deliveryDays,
    delivery_days_min: deliveryDays,
    delivery_days_max: deliveryDays,
    estimate_label: transitBusinessDays > 0 ? `${transitBusinessDays} business days` : 'Immediate',
    selected_at: payload.quoted_at || '2026-08-09T00:00:00.000Z',
    quoted_at: payload.quoted_at || '2026-08-09T00:00:00.000Z',
    distance,
    distance_source: payload.distance_source || 'manual',
    per_km: perKm,
    zipcode,
    snapshot: true
  };
}

class OnboardingShippingSelectService {
  constructor(repository) {
    this.repository = repository;
  }

  async selectShipping({ userId, payload }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding shipping select repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    const shipping = normalizeShippingPayload(payload);
    const data = await this.repository.selectShipping(userId, shipping);

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingShippingSelectService,
  normalizeShippingPayload
};
