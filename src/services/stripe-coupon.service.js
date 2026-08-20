const { HttpError } = require('../core/http-error');
const {
  expectedPercentForTerm,
  isPromoId,
  isValidSubscriptionTerm,
  VALID_SUBSCRIPTION_TERMS
} = require('../core/first-purchase-discount');

function normalizePromoId(value) {
  const promoId = String(value || '').trim();
  return isPromoId(promoId) ? promoId : null;
}

function stripeDashboardBase(secretKey) {
  return String(secretKey || '').startsWith('sk_test_')
    ? 'https://dashboard.stripe.com/test'
    : 'https://dashboard.stripe.com';
}

class StripeCouponService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.stripeBilling = options.stripeBilling || null;
    this.secretKey = options.secretKey || '';
    this.envMapping = {
      1: normalizePromoId(options.envMapping && options.envMapping[1]),
      3: normalizePromoId(options.envMapping && options.envMapping[3]),
      6: normalizePromoId(options.envMapping && options.envMapping[6])
    };
  }

  envSlotsSet() {
    return VALID_SUBSCRIPTION_TERMS.filter((term) => Boolean(this.envMapping[term]));
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Stripe coupon repository is not available.');
    }
  }

  ensureStripe() {
    if (!this.stripeBilling || typeof this.stripeBilling.ensureClient !== 'function') {
      throw new HttpError(503, 'Stripe client is not available.', { code: 'stripe_sdk_missing' });
    }

    return this.stripeBilling.ensureClient();
  }

  async getStoredMapping() {
    this.ensureRepository();
    const stored = await this.repository.getMapping();
    return {
      mapping: stored && stored.mapping ? stored.mapping : { 1: null, 3: null, 6: null },
      coupons: stored && stored.coupons ? stored.coupons : { 1: null, 3: null, 6: null }
    };
  }

  async getMapping() {
    const stored = await this.getStoredMapping();
    return {
      1: stored.mapping[1] || this.envMapping[1] || null,
      3: stored.mapping[3] || this.envMapping[3] || null,
      6: stored.mapping[6] || this.envMapping[6] || null
    };
  }

  async getPromotionCodeIdForTerm(termMonths) {
    const mapping = await this.getMapping();
    const term = Number(termMonths);
    return mapping[term] || null;
  }

  async mappingHealth() {
    const mapping = await this.getMapping();
    const missingTerms = VALID_SUBSCRIPTION_TERMS.filter((term) => !mapping[term]);
    const misconfigCount = this.repository && this.repository.getMisconfigCount
      ? await this.repository.getMisconfigCount()
      : 0;

    return {
      complete: missingTerms.length === 0,
      missing_terms: missingTerms,
      mapping,
      misconfig_count: misconfigCount
    };
  }

  async incrementMisconfigMetric() {
    this.ensureRepository();
    return this.repository.incrementMisconfigCount();
  }

  async saveMapping(mapping = {}, coupons = {}) {
    this.ensureRepository();

    const sanitized = {};
    const sanitizedCoupons = {};

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = normalizePromoId(mapping[term] || mapping[String(term)]);
      if (!promoId) {
        continue;
      }

      sanitized[term] = promoId;
      const couponId = coupons[term] || coupons[String(term)] || null;
      if (couponId) {
        sanitizedCoupons[term] = String(couponId);
      }
    }

    await this.repository.saveMapping(sanitized, sanitizedCoupons);
    return this.mappingHealth();
  }

  async resolveFirstPurchasePromotionForCheckout({ eligible, termMonths }) {
    if (!eligible) {
      return null;
    }

    if (!isValidSubscriptionTerm(termMonths)) {
      throw new HttpError(503, 'First purchase promotion is not configured.', {
        code: 'first_purchase_promo_not_configured'
      });
    }

    const promotionCodeId = await this.getPromotionCodeIdForTerm(termMonths);
    if (!promotionCodeId) {
      await this.incrementMisconfigMetric();
      throw new HttpError(503, 'First purchase promotion is not configured.', {
        code: 'first_purchase_promo_not_configured'
      });
    }

    return {
      promotion_code_id: promotionCodeId,
      discount_percent: expectedPercentForTerm(termMonths),
      discount_duration: 'once'
    };
  }

  async createFirstPurchaseCoupon(payload = {}) {
    const termMonths = Number(payload.term_months);
    if (!isValidSubscriptionTerm(termMonths)) {
      throw new HttpError(400, 'Invalid subscription term.', { code: 'invalid_term' });
    }

    const code = String(payload.code || '').trim();
    if (!code) {
      throw new HttpError(400, 'Invalid promotion code.', { code: 'invalid_promotion_code' });
    }

    const percentOff = expectedPercentForTerm(termMonths);
    if (payload.percent_off != null && Number(payload.percent_off) !== percentOff) {
      throw new HttpError(400, 'Percent off is not editable for first-purchase coupons.', {
        code: 'percent_off_locked'
      });
    }

    const name = String(payload.name || '').trim() || `First purchase ${termMonths}m (${percentOff}%)`;
    const maxRedemptions = Math.max(0, Number(payload.max_redemptions) || 0);
    const stripe = this.ensureStripe();

    const coupon = await stripe.coupons.create({
      percent_off: percentOff,
      duration: 'once',
      name,
      metadata: {
        pawbowl_purpose: 'first_purchase',
        pawbowl_term_months: String(termMonths)
      }
    });

    const promotionPayload = {
      coupon: coupon.id,
      code,
      restrictions: {
        first_time_transaction: true
      },
      metadata: {
        pawbowl_purpose: 'first_purchase',
        pawbowl_term_months: String(termMonths)
      }
    };

    if (maxRedemptions > 0) {
      promotionPayload.max_redemptions = maxRedemptions;
    }

    const promotionCode = await stripe.promotionCodes.create(promotionPayload);
    let health = await this.mappingHealth();

    if (payload.assign_first_purchase_slot !== false) {
      health = await this.saveMapping({
        ...health.mapping,
        [termMonths]: promotionCode.id
      }, {
        [termMonths]: coupon.id
      });
    }

    return {
      success: true,
      data: {
        created: true,
        mapped: payload.assign_first_purchase_slot !== false,
        coupon_id: coupon.id,
        promotion_code_id: promotionCode.id,
        code: promotionCode.code,
        percent_off: percentOff,
        health
      }
    };
  }

  async listRecentPromotionCodes(limit = 25) {
    const stripe = this.ensureStripe();
    const mapping = await this.getMapping();
    const mappedIds = new Map(
      VALID_SUBSCRIPTION_TERMS
        .filter((term) => mapping[term])
        .map((term) => [mapping[term], term])
    );
    const listed = await stripe.promotionCodes.list({
      limit: Math.min(25, Math.max(1, Number(limit) || 25)),
      expand: ['data.coupon']
    });
    const dashboardBase = stripeDashboardBase(this.secretKey);

    return {
      success: true,
      data: {
        items: (listed && Array.isArray(listed.data) ? listed.data : []).map((item) => ({
          id: item.id,
          code: item.code,
          coupon_id: typeof item.coupon === 'string' ? item.coupon : item.coupon && item.coupon.id,
          percent_off: typeof item.coupon === 'object' && item.coupon ? item.coupon.percent_off : null,
          duration: typeof item.coupon === 'object' && item.coupon ? item.coupon.duration : null,
          active: Boolean(item.active),
          slot: mappedIds.get(item.id) || null,
          dashboard_url: `${dashboardBase}/promotion_codes/${item.id}`
        }))
      }
    };
  }
}

module.exports = {
  StripeCouponService,
  normalizePromoId
};
