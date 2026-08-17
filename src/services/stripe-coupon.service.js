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

class StripeCouponService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.envMapping = {
      1: normalizePromoId(options.envMapping && options.envMapping[1]),
      3: normalizePromoId(options.envMapping && options.envMapping[3]),
      6: normalizePromoId(options.envMapping && options.envMapping[6])
    };
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Stripe coupon repository is not available.');
    }
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
}

module.exports = {
  StripeCouponService,
  normalizePromoId
};
