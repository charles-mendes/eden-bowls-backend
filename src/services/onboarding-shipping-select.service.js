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
  const originalAmount = normalizeNonNegativeNumber(payload.original_amount, cost);
  const chargeEnabled = payload.charge_enabled == null ? true : payload.charge_enabled === true;

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
    selected_at: payload.quoted_at || new Date().toISOString(),
    quoted_at: payload.quoted_at || new Date().toISOString(),
    distance,
    distance_source: payload.distance_source || 'manual',
    per_km: perKm,
    zipcode,
    quote_token: String(payload.quote_token || '').trim(),
    // What the quote said the customer pays (customer-shipping-charge). The checkout recomputes it with the switch
    // read when it is placed; these are kept to show the selection as it was quoted.
    original_amount: originalAmount,
    charged_amount: normalizeNonNegativeNumber(payload.charged_amount, cost),
    charge_enabled: chargeEnabled,
    company_cost: chargeEnabled ? null : originalAmount,
    source: ['ups', 'fixed', 'fallback'].includes(String(payload.source || '')) ? String(payload.source) : null,
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
