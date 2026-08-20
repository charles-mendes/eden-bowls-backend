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

function couponIdFromPromo(promo) {
  if (!promo) {
    return null;
  }

  if (typeof promo.coupon === 'string' && promo.coupon.trim()) {
    return promo.coupon.trim();
  }

  if (promo.coupon && typeof promo.coupon === 'object' && promo.coupon.id) {
    return String(promo.coupon.id);
  }

  return null;
}

function percentOffFromPromo(promo) {
  if (promo && promo.coupon && typeof promo.coupon === 'object') {
    return Number(promo.coupon.percent_off);
  }

  return Number.NaN;
}

function termFromStripePromo(promo) {
  const metadata = promo && promo.metadata ? promo.metadata : {};
  const metaTerm = Number(metadata.pawbowl_term_months);
  if (isValidSubscriptionTerm(metaTerm)) {
    return metaTerm;
  }

  const percent = percentOffFromPromo(promo);
  for (const term of VALID_SUBSCRIPTION_TERMS) {
    if (expectedPercentForTerm(term) === percent) {
      return term;
    }
  }

  return null;
}

function isFirstPurchasePromo(promo) {
  if (!promo) {
    return false;
  }

  const metadata = promo.metadata || {};
  if (metadata.pawbowl_purpose === 'first_purchase') {
    return true;
  }

  const firstTime = Boolean(promo.restrictions && promo.restrictions.first_time_transaction);
  const duration = promo.coupon && typeof promo.coupon === 'object' ? promo.coupon.duration : null;
  return firstTime && duration === 'once';
}

class StripeCouponService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.stripeBilling = options.stripeBilling || null;
    this.secretKey = options.secretKey || '';
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
      1: stored.mapping[1] || null,
      3: stored.mapping[3] || null,
      6: stored.mapping[6] || null
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

  sanitizeMapping(mapping = {}, coupons = {}) {
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

    return { mapping: sanitized, coupons: sanitizedCoupons };
  }

  async persistMapping(mapping = {}, coupons = {}) {
    this.ensureRepository();
    const sanitized = this.sanitizeMapping(mapping, coupons);
    await this.repository.saveMapping(sanitized.mapping, sanitized.coupons);
    return this.mappingHealth();
  }

  async retrievePromotionCode(promoId) {
    const stripe = this.ensureStripe();
    try {
      return await stripe.promotionCodes.retrieve(promoId, { expand: ['coupon'] });
    } catch (error) {
      throw new HttpError(422, 'Promotion code is invalid.', {
        code: 'invalid_promotion_code_id',
        promotion_code_id: promoId
      });
    }
  }

  async enrichMappingFromStripe(mapping, coupons) {
    if (!this.stripeBilling) {
      return { mapping, coupons };
    }

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = mapping[term];
      if (!promoId) {
        continue;
      }

      const promo = await this.retrievePromotionCode(promoId);
      if (!promo || promo.active === false) {
        throw new HttpError(422, 'Promotion code is invalid.', {
          code: 'invalid_promotion_code_id',
          promotion_code_id: promoId,
          term_months: term
        });
      }

      const couponId = couponIdFromPromo(promo);
      if (couponId) {
        coupons[term] = couponId;
      }
    }

    return { mapping, coupons };
  }

  async saveMapping(mapping = {}, coupons = {}) {
    const sanitized = this.sanitizeMapping(mapping, coupons);
    await this.enrichMappingFromStripe(sanitized.mapping, sanitized.coupons);
    return this.persistMapping(sanitized.mapping, sanitized.coupons);
  }

  async seedEmptySlots(fallbackMapping = {}) {
    const stored = await this.getStoredMapping();
    const mapping = {};

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      if (stored.mapping[term]) {
        continue;
      }

      const promoId = normalizePromoId(fallbackMapping[term] || fallbackMapping[String(term)]);
      if (promoId) {
        mapping[term] = promoId;
      }
    }

    if (!Object.keys(mapping).length) {
      return this.mappingHealth();
    }

    return this.persistMapping(mapping, stored.coupons);
  }

  async listStripePromotionCodes(limit = 100) {
    const stripe = this.ensureStripe();
    const listed = await stripe.promotionCodes.list({
      limit: Math.min(100, Math.max(1, Number(limit) || 100)),
      expand: ['data.coupon']
    });
    return listed && Array.isArray(listed.data) ? listed.data : [];
  }

  couponNeedsHydration(promo) {
    const coupon = promo && promo.coupon;
    return !(coupon && typeof coupon === 'object' && !coupon.deleted && (coupon.percent_off != null || coupon.duration));
  }

  async hydratePromotionCoupons(promos = []) {
    const stripe = this.ensureStripe();
    const missingIds = [];
    const seen = new Set();

    for (const promo of promos) {
      if (!this.couponNeedsHydration(promo)) {
        continue;
      }

      const couponId = couponIdFromPromo(promo);
      if (!couponId || seen.has(couponId)) {
        continue;
      }

      seen.add(couponId);
      missingIds.push(couponId);
    }

    const couponsById = new Map();
    await Promise.all(missingIds.map(async (couponId) => {
      try {
        couponsById.set(couponId, await stripe.coupons.retrieve(couponId));
      } catch {
        couponsById.set(couponId, null);
      }
    }));

    return promos.map((promo) => {
      if (!this.couponNeedsHydration(promo)) {
        return promo;
      }

      const coupon = couponsById.get(couponIdFromPromo(promo));
      return coupon ? { ...promo, coupon } : promo;
    });
  }

  async syncFirstPurchasePromos() {
    const stored = await this.getStoredMapping();
    const listed = await this.listStripePromotionCodes(100);
    const byId = new Map(listed.map((item) => [item.id, item]));

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = stored.mapping[term];
      if (!promoId || byId.has(promoId)) {
        continue;
      }

      try {
        byId.set(promoId, await this.retrievePromotionCode(promoId));
      } catch {
        // Slot stays as stored; reported in missing_in_stripe.
      }
    }

    const mapping = { ...stored.mapping };
    const coupons = { ...stored.coupons };
    const slots = {};
    const missingInStripe = [];
    const inactive = [];

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = mapping[term];
      if (!promoId) {
        continue;
      }

      const promo = byId.get(promoId);
      if (!promo) {
        missingInStripe.push(term);
        slots[term] = {
          promotion_code_id: promoId,
          coupon_id: coupons[term] || null,
          active: false,
          source: 'stored'
        };
        continue;
      }

      if (promo.active === false) {
        inactive.push(term);
      }

      const couponId = couponIdFromPromo(promo);
      if (couponId) {
        coupons[term] = couponId;
      }

      slots[term] = {
        promotion_code_id: promoId,
        coupon_id: couponId || coupons[term] || null,
        active: Boolean(promo.active),
        source: 'stored'
      };
    }

    const candidates = listed
      .filter((promo) => isFirstPurchasePromo(promo) && promo.active !== false)
      .sort((left, right) => Number(right.created || 0) - Number(left.created || 0));

    for (const promo of candidates) {
      const term = termFromStripePromo(promo);
      if (!term || mapping[term]) {
        continue;
      }

      mapping[term] = promo.id;
      const couponId = couponIdFromPromo(promo);
      if (couponId) {
        coupons[term] = couponId;
      }
      slots[term] = {
        promotion_code_id: promo.id,
        coupon_id: couponId,
        active: true,
        source: 'stripe'
      };
    }

    const health = await this.persistMapping(mapping, coupons);
    return {
      ...health,
      slots,
      missing_in_stripe: missingInStripe,
      inactive
    };
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
      health = await this.persistMapping({
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
    const mapping = await this.getMapping();
    const mappedIds = new Map(
      VALID_SUBSCRIPTION_TERMS
        .filter((term) => mapping[term])
        .map((term) => [mapping[term], term])
    );
    const listed = await this.hydratePromotionCoupons(
      await this.listStripePromotionCodes(Math.min(25, Math.max(1, Number(limit) || 25)))
    );
    const dashboardBase = stripeDashboardBase(this.secretKey);

    return {
      success: true,
      data: {
        items: listed.map((item) => ({
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
