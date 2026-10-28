const { HttpError } = require('../core/http-error');
const {
  expectedPercentForTerm,
  isPromoId,
  isValidSubscriptionTerm,
  MAX_TERM_PERCENT,
  MIN_TERM_PERCENT,
  planTermsFor,
  TERM_PERCENT_MAP,
  VALID_SUBSCRIPTION_TERMS
} = require('../core/first-purchase-discount');
const { parseStripeAccountInput } = require('../core/stripe-account');
const { resolveStripeBilling } = require('../infrastructure/stripe/stripe-accounts');

function normalizePromoId(value) {
  const promoId = String(value || '').trim();
  return isPromoId(promoId) ? promoId : null;
}

// API 2025-09-30.clover moved a promotion code's coupon under promotion.coupon. The rest of this
// service reads promo.coupon, so promotion codes are normalized once when they come from Stripe.
function withPromotionCoupon(promo) {
  if (!promo || typeof promo !== 'object') {
    return promo;
  }
  const nested = promo.promotion && promo.promotion.coupon;
  if (!nested || promo.coupon) {
    return promo;
  }
  return { ...promo, coupon: nested };
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

// Term of a first-purchase promotion code: its metadata, else the term whose stored percent it gives.
function termFromStripePromo(promo, percents = TERM_PERCENT_MAP) {
  const metadata = promo && promo.metadata ? promo.metadata : {};
  const metaTerm = Number(metadata.pawbowl_term_months);
  if (isValidSubscriptionTerm(metaTerm)) {
    return metaTerm;
  }

  const percent = percentOffFromPromo(promo);
  for (const term of VALID_SUBSCRIPTION_TERMS) {
    if (expectedPercentForTerm(term, percents) === percent) {
      return term;
    }
  }

  return null;
}

function parsePercentOff(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }
  const percent = Number(value);
  if (!Number.isInteger(percent) || percent < MIN_TERM_PERCENT || percent > MAX_TERM_PERCENT) {
    throw new HttpError(422, `Percent off must be a whole number from ${MIN_TERM_PERCENT} to ${MAX_TERM_PERCENT}.`, {
      code: 'invalid_percent_off'
    });
  }
  return percent;
}

function actorIdOf(actor) {
  const id = actor && (actor.userId || actor.id);
  return id ? Number(id) : null;
}

// percent_off of the slot's coupon in Stripe and whether it differs from the stored percent of the term.
function slotPercent(promo, term, percents) {
  const percentOff = percentOffFromPromo(promo);
  if (!Number.isFinite(percentOff)) {
    return { percent_off: null, percent_mismatch: false };
  }
  return { percent_off: percentOff, percent_mismatch: percentOff !== expectedPercentForTerm(term, percents) };
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
    this.termDiscounts = options.termDiscounts || null;
    this.auditRepository = options.auditRepository || null;
    this.dataSource = options.dataSource || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.stripeBilling = options.stripeBilling || null;
    this.secretKey = options.secretKey || '';
    this.stripeBrEnabled = options.stripeBrEnabled;
  }

  accountOf(account) {
    return parseStripeAccountInput(account);
  }

  // Stored percent per term of the account ({ 1, 3, 6 }), or the percents of before the table without its repository.
  async termPercents(account) {
    const stripeAccount = this.accountOf(account);
    if (!this.termDiscounts || typeof this.termDiscounts.percentsFor !== 'function') {
      return { ...TERM_PERCENT_MAP };
    }
    return this.termDiscounts.percentsFor(stripeAccount);
  }

  ensureRepository() {
    if (!this.repository) {
      throw new HttpError(503, 'Stripe coupon repository is not available.');
    }
  }

  ensureStripe(account, { forCreation = false } = {}) {
    const stripeAccount = this.accountOf(account);
    const billing = resolveStripeBilling(this, stripeAccount, { forCreation });
    if (!billing || typeof billing.ensureClient !== 'function') {
      throw new HttpError(503, 'Stripe client is not available.', {
        code: 'stripe_sdk_missing',
        stripe_account: stripeAccount
      });
    }

    return billing.ensureClient();
  }

  secretFor(account) {
    const stripeAccount = this.accountOf(account);
    try {
      const billing = resolveStripeBilling(this, stripeAccount);
      return billing.secretKey || this.secretKey || '';
    } catch {
      return this.secretKey || '';
    }
  }

  async getStoredMapping(account) {
    this.ensureRepository();
    const stored = await this.repository.getMapping(this.accountOf(account));
    return {
      mapping: stored && stored.mapping ? stored.mapping : { 1: null, 3: null, 6: null },
      coupons: stored && stored.coupons ? stored.coupons : { 1: null, 3: null, 6: null }
    };
  }

  async getMapping(account) {
    const stored = await this.getStoredMapping(account);
    return {
      1: stored.mapping[1] || null,
      3: stored.mapping[3] || null,
      6: stored.mapping[6] || null
    };
  }

  async getPromotionCodeIdForTerm(termMonths, account) {
    const mapping = await this.getMapping(account);
    const term = Number(termMonths);
    return mapping[term] || null;
  }

  async mappingHealth(account) {
    const mapping = await this.getMapping(account);
    const missingTerms = VALID_SUBSCRIPTION_TERMS.filter((term) => !mapping[term]);
    const misconfigCount = this.repository && this.repository.getMisconfigCount
      ? await this.repository.getMisconfigCount()
      : 0;

    return {
      complete: missingTerms.length === 0,
      missing_terms: missingTerms,
      mapping,
      // The percent of each term, the same list the plan snapshot offers as plan_terms.
      terms: planTermsFor(await this.termPercents(account)),
      misconfig_count: misconfigCount,
      stripe_account: this.accountOf(account)
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

  async persistMapping(mapping = {}, coupons = {}, account) {
    this.ensureRepository();
    const sanitized = this.sanitizeMapping(mapping, coupons);
    await this.repository.saveMapping(sanitized.mapping, sanitized.coupons, this.accountOf(account));
    return this.mappingHealth(account);
  }

  async retrievePromotionCode(promoId, account) {
    const stripe = this.ensureStripe(account);
    try {
      return withPromotionCoupon(await stripe.promotionCodes.retrieve(promoId, { expand: ['promotion.coupon'] }));
    } catch (error) {
      throw new HttpError(422, 'Promotion code is invalid.', {
        code: 'invalid_promotion_code_id',
        promotion_code_id: promoId,
        stripe_account: this.accountOf(account)
      });
    }
  }

  async enrichMappingFromStripe(mapping, coupons, account) {
    try {
      resolveStripeBilling(this, this.accountOf(account));
    } catch {
      return { mapping, coupons };
    }

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = mapping[term];
      if (!promoId) {
        continue;
      }

      const promo = await this.retrievePromotionCode(promoId, account);
      if (!promo || promo.active === false) {
        throw new HttpError(422, 'Promotion code is invalid.', {
          code: 'invalid_promotion_code_id',
          promotion_code_id: promoId,
          term_months: term,
          stripe_account: this.accountOf(account)
        });
      }

      const couponId = couponIdFromPromo(promo);
      if (couponId) {
        coupons[term] = couponId;
      }
    }

    return { mapping, coupons };
  }

  async saveMapping(mapping = {}, coupons = {}, account) {
    const sanitized = this.sanitizeMapping(mapping, coupons);
    await this.enrichMappingFromStripe(sanitized.mapping, sanitized.coupons, account);
    return this.persistMapping(sanitized.mapping, sanitized.coupons, account);
  }

  async seedEmptySlots(fallbackMapping = {}, account) {
    const stored = await this.getStoredMapping(account);
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
      return this.mappingHealth(account);
    }

    return this.persistMapping(mapping, stored.coupons, account);
  }

  async listStripePromotionCodes(limit = 100, account) {
    const stripe = this.ensureStripe(account);
    const listed = await stripe.promotionCodes.list({
      limit: Math.min(100, Math.max(1, Number(limit) || 100)),
      expand: ['data.promotion.coupon']
    });
    return listed && Array.isArray(listed.data) ? listed.data.map(withPromotionCoupon) : [];
  }

  couponNeedsHydration(promo) {
    const coupon = promo && promo.coupon;
    return !(coupon && typeof coupon === 'object' && !coupon.deleted && (coupon.percent_off != null || coupon.duration));
  }

  async hydratePromotionCoupons(promos = [], account) {
    const stripe = this.ensureStripe(account);
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

  async syncFirstPurchasePromos(account) {
    const stored = await this.getStoredMapping(account);
    const listed = await this.listStripePromotionCodes(100, account);
    const byId = new Map(listed.map((item) => [item.id, item]));

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = stored.mapping[term];
      if (!promoId || byId.has(promoId)) {
        continue;
      }

      try {
        byId.set(promoId, await this.retrievePromotionCode(promoId, account));
      } catch {
        // Slot stays as stored; reported in missing_in_stripe.
      }
    }

    const mapping = { ...stored.mapping };
    const coupons = { ...stored.coupons };
    const percents = await this.termPercents(account);
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
          source: 'stored',
          percent_off: null,
          percent_mismatch: false
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
        source: 'stored',
        ...slotPercent(promo, term, percents)
      };
    }

    const candidates = listed
      .filter((promo) => isFirstPurchasePromo(promo) && promo.active !== false)
      .sort((left, right) => Number(right.created || 0) - Number(left.created || 0));

    for (const promo of candidates) {
      const term = termFromStripePromo(promo, percents);
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
        source: 'stripe',
        ...slotPercent(promo, term, percents)
      };
    }

    const health = await this.persistMapping(mapping, coupons, account);
    return {
      ...health,
      slots,
      missing_in_stripe: missingInStripe,
      inactive,
      stripe_account: this.accountOf(account)
    };
  }

  async resolveFirstPurchasePromotionForCheckout({ eligible, termMonths, account }) {
    if (!eligible) {
      return null;
    }

    if (!isValidSubscriptionTerm(termMonths)) {
      throw new HttpError(503, 'First purchase promotion is not configured.', {
        code: 'first_purchase_promo_not_configured',
        stripe_account: this.accountOf(account)
      });
    }

    const promotionCodeId = await this.getPromotionCodeIdForTerm(termMonths, account);
    if (!promotionCodeId) {
      await this.incrementMisconfigMetric();
      throw new HttpError(503, 'First purchase promotion is not configured.', {
        code: 'first_purchase_promo_not_configured',
        stripe_account: this.accountOf(account)
      });
    }

    return {
      promotion_code_id: promotionCodeId,
      discount_percent: expectedPercentForTerm(termMonths, await this.termPercents(account)),
      discount_duration: 'once'
    };
  }

  // Stores the percent of a term and its audit event in one transaction (billing.first_purchase.percent.update).
  async saveTermPercent({ account, termMonths, from, to, actor }) {
    const work = async (manager) => {
      await this.termDiscounts.savePercent({ account, termMonths, percent: to, actorId: actorIdOf(actor) }, manager);
      if (this.auditRepository && typeof this.auditRepository.createIn === 'function') {
        await this.auditRepository.createIn(manager || this.dataSource, {
          actorUserId: actorIdOf(actor),
          actorEmail: (actor && actor.email) || null,
          action: 'billing.first_purchase.percent.update',
          metadata: { stripe_account: account, term_months: termMonths, from, to }
        });
      }
    };
    if (this.dataSource && typeof this.dataSource.transaction === 'function') {
      return this.dataSource.transaction(work);
    }
    return work(null);
  }

  // A new percent needs a new coupon, since Stripe cannot change a coupon's percent: existing subscriptions keep
  // the previous one. Stripe first, then the mapping, then the percent, so a refused coupon changes nothing.
  async createFirstPurchaseCoupon(payload = {}, actor = {}) {
    const account = this.accountOf(payload.account);
    const termMonths = Number(payload.term_months);
    if (!isValidSubscriptionTerm(termMonths)) {
      throw new HttpError(400, 'Invalid subscription term.', { code: 'invalid_term' });
    }

    const code = String(payload.code || '').trim();
    if (!code) {
      throw new HttpError(400, 'Invalid promotion code.', { code: 'invalid_promotion_code' });
    }

    const storedPercent = expectedPercentForTerm(termMonths, await this.termPercents(account));
    const percentOff = parsePercentOff(payload.percent_off, storedPercent);

    const name = String(payload.name || '').trim() || `First purchase ${termMonths}m (${percentOff}%)`;
    const maxRedemptions = Math.max(0, Number(payload.max_redemptions) || 0);
    const stripe = this.ensureStripe(account, { forCreation: true });

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
      promotion: { type: 'coupon', coupon: coupon.id },
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
    let health = await this.mappingHealth(account);

    if (payload.assign_first_purchase_slot !== false) {
      await this.persistMapping({
        ...health.mapping,
        [termMonths]: promotionCode.id
      }, {
        [termMonths]: coupon.id
      }, account);
      if (percentOff !== storedPercent && this.termDiscounts) {
        await this.saveTermPercent({ account, termMonths, from: storedPercent, to: percentOff, actor });
      }
      health = await this.mappingHealth(account);
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
        stripe_account: account,
        health
      }
    };
  }

  async listRecentPromotionCodes(limit = 25, account) {
    const mapping = await this.getMapping(account);
    const mappedIds = new Map(
      VALID_SUBSCRIPTION_TERMS
        .filter((term) => mapping[term])
        .map((term) => [mapping[term], term])
    );
    const listed = await this.hydratePromotionCoupons(
      await this.listStripePromotionCodes(Math.min(25, Math.max(1, Number(limit) || 25)), account),
      account
    );
    const dashboardBase = stripeDashboardBase(this.secretFor(account));

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
  termFromStripePromo,
  StripeCouponService,
  normalizePromoId
};
