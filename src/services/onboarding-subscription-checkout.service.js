const { HttpError } = require('../core/http-error');
const {
  canResolvePlanSelection,
  isPricedPlanSelection,
  validateCheckoutState
} = require('../core/checkout-state');
const { resolveMarket } = require('../core/market');
const {
  applyFirstPurchaseDiscount,
  expectedPercentForTerm
} = require('../core/first-purchase-discount');
const { buildPetsSnapshot, extractSubscriptionPeriod } = require('../core/stripe-subscription-map');
const {
  buildCheckoutFingerprint,
  buildSubscriptionCreateIdempotencyKey,
  defaultCheckoutLockStore,
  evaluateCheckoutReuse,
  fingerprintsMatch,
  resolveAttemptId
} = require('../core/checkout-idempotency');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CHECKOUT_MODE = 'subscription_first';
const SUBSCRIBED_PET_STATUSES = new Set(['active', 'trialing', 'incomplete', 'past_due', 'paused', 'unpaid']);

function pushPetIdentity(ids, pet) {
  if (pet == null) {
    return;
  }
  if (typeof pet === 'string' || typeof pet === 'number') {
    ids.push(pet);
    return;
  }
  if (typeof pet !== 'object') {
    return;
  }
  ids.push(pet.pet_id, pet.id);
}

function collectPetIdsFromSnapshot(snapshot = {}, planSelection = {}) {
  const ids = [];
  if (Array.isArray(snapshot.pet_ids)) {
    ids.push(...snapshot.pet_ids);
  }
  if (Array.isArray(snapshot.pets)) {
    snapshot.pets.forEach((pet) => pushPetIdentity(ids, pet));
  }
  if (Array.isArray(planSelection.pets)) {
    planSelection.pets.forEach((pet) => pushPetIdentity(ids, pet));
  }
  return ids;
}

function getPaymentMethodId(payload = {}) {
  return String(payload.payment_method_id || payload.paymentMethodId || '').trim();
}

function getCheckoutMode() {
  return CHECKOUT_MODE;
}

function isValidEmail(email) {
  return EMAIL_PATTERN.test(String(email || '').trim());
}

function applyDiscountToCatalogPricing(catalogPricing, percent) {
  if (!catalogPricing || typeof catalogPricing !== 'object') {
    return catalogPricing || null;
  }

  const subtotal = Number(catalogPricing.subtotal);
  if (!Number.isFinite(subtotal)) {
    return catalogPricing;
  }

  return {
    ...catalogPricing,
    discounted_first_month_total: applyFirstPurchaseDiscount(subtotal, percent)
  };
}

function presentCheckout(checkout = {}) {
  const data = {
    ...checkout,
    order_id: 0,
    order_key: checkout.order_key || '',
    payment_url: '',
    subscription_ids: Array.isArray(checkout.subscription_ids) ? checkout.subscription_ids : [],
    flexible_subscription_id: Number(checkout.flexible_subscription_id || 0),
    checkout_mode: CHECKOUT_MODE
  };
  delete data.session_id;
  if (data.payment_state === 'paid') {
    delete data.stripe_client_secret;
  }
  return data;
}

class OnboardingSubscriptionCheckoutService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.authService = options.authService || null;
    this.discountEligibilityRepository = options.discountEligibilityRepository || null;
    this.stripeCouponService = options.stripeCouponService || null;
    this.stripeBilling = options.stripeBilling || null;
    this.customerStore = options.customerStore || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.lockStore = options.lockStore || defaultCheckoutLockStore;
    this.planPreviewRepository = options.planPreviewRepository || null;
  }

  async checkout({ userId, payload = {} }) {
    if (!this.repository) {
      throw new HttpError(503, 'Onboarding subscription checkout repository is not available.');
    }

    if (!userId) {
      throw new HttpError(401, 'Authentication is required.', { code: 'unauthorized' });
    }

    if (!this.authService) {
      throw new HttpError(503, 'Auth service is not available for critical operations.');
    }

    await this.authService.assertCriticalOperationAllowed(userId);

    if (!this.discountEligibilityRepository) {
      throw new HttpError(503, 'Onboarding discount eligibility repository is not available.');
    }

    if (!this.stripeCouponService) {
      throw new HttpError(503, 'Stripe coupon service is not available.');
    }

    const paymentMethodId = getPaymentMethodId(payload);
    if (!paymentMethodId.startsWith('pm_')) {
      throw new HttpError(422, 'A valid payment method is required.', {
        code: 'invalid_payment_method'
      });
    }

    const rawContext = this.repository.getCheckoutContext
      ? await this.repository.getCheckoutContext(userId)
      : { planSelection: this.repository.getPlanSelection ? await this.repository.getPlanSelection(userId) : null };
    const context = await this.ensurePricedPlanSelection(userId, rawContext);
    validateCheckoutState(context);

    const eligibility = await this.discountEligibilityRepository.getEligibility(userId);
    const planSelection = context.planSelection || (
      this.repository.getPlanSelection ? await this.repository.getPlanSelection(userId) : null
    );
    const termMonths = Number(planSelection && planSelection.subscription_term_months);
    const eligible = Boolean(eligibility && eligibility.eligible);
    const promotion = await this.stripeCouponService.resolveFirstPurchasePromotionForCheckout({
      eligible,
      termMonths
    });
    const appliedPercent = promotion
      ? Number(promotion.discount_percent)
      : (eligible ? expectedPercentForTerm(termMonths) : 0);
    const catalogPricing = applyDiscountToCatalogPricing(
      planSelection && planSelection.catalog_pricing,
      appliedPercent
    );
    const nextPlanSelection = catalogPricing
      ? { ...planSelection, catalog_pricing: catalogPricing }
      : planSelection;

    const billing = payload.billing || {};
    const user = this.repository.getUserEmail
      ? await this.repository.getUserEmail(userId)
      : { email: billing.email || '', name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim() };
    const email = isValidEmail(user.email) ? String(user.email).trim() : String(billing.email || '').trim();
    if (!isValidEmail(email)) {
      throw new HttpError(422, 'Customer email is invalid.', {
        code: 'invalid_customer_email'
      });
    }

    const items = this.repository.resolveSubscriptionItems
      ? await this.repository.resolveSubscriptionItems(nextPlanSelection)
      : [];
    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpError(422, 'At least one valid Stripe price is required.', {
        code: 'invalid_price_id'
      });
    }

    const address = context.address || {};
    const country = String(address.country || '').toUpperCase();
    const zipcode = String(address.zipcode || address.postal_code || '').trim();
    if (country === 'US' && this.stripeBilling && this.stripeBilling.automaticTaxEnabled && !zipcode) {
      throw new HttpError(422, 'Sales tax quote is unavailable.', {
        code: 'sales_tax_unavailable'
      });
    }

    if (!this.stripeBilling) {
      throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', { code: 'stripe_secret_missing' });
    }

    const promotionCodeId = promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null;
    const fingerprint = buildCheckoutFingerprint({
      userId,
      currency: catalogPricing && catalogPricing.currency,
      subtotal: catalogPricing && catalogPricing.subtotal,
      discountedFirstMonthTotal: catalogPricing && catalogPricing.discounted_first_month_total,
      subscriptionTermMonths: termMonths,
      lineItems: catalogPricing && catalogPricing.line_items,
      pets: context.pets,
      shipping: context.shipping || {},
      address,
      promotionCodeId
    });

    const releaseLock = this.lockStore.acquire(userId, fingerprint);
    try {
      const freshContext = this.repository.getCheckoutContext
        ? await this.repository.getCheckoutContext(userId)
        : context;
      const storedReference = freshContext.checkoutReference || {};
      const fingerprintMatches = fingerprintsMatch(storedReference.checkout_context_fingerprint, fingerprint);
      const attemptId = resolveAttemptId({
        payloadAttemptId: payload.attempt_id,
        storedAttemptId: storedReference.attempt_id,
        fingerprintMatches
      });
      const currentPetIds = buildPetsSnapshot(nextPlanSelection, freshContext.pets || context.pets).pet_ids;
      const subscribedPetIds = await this.collectSubscribedPetIds(userId, storedReference);

      const reuse = evaluateCheckoutReuse(storedReference, fingerprint, {
        currentPetIds,
        subscribedPetIds
      });
      if (reuse.reuse) {
        const reusedCheckout = await this.buildReusedCheckout({
          storedReference,
          paymentMethodId,
          billing,
          user,
          email,
          eligibility,
          appliedPercent,
          promotion,
          catalogPricing,
          attemptId,
          fingerprint,
          petIds: currentPetIds
        });
        const data = await this.persistCheckout({
          userId,
          payload,
          paymentMethodId,
          billing,
          eligibility,
          appliedPercent,
          promotion,
          nextPlanSelection,
          shipping: context.shipping || {},
          checkout: reusedCheckout
        });
        return { success: true, data: presentCheckout(data) };
      }

      const existingCustomerId = this.customerStore
        ? await this.customerStore.getCustomerId(userId)
        : '';
      const created = await this.stripeBilling.createOnboardingSubscription({
        userId,
        email,
        name: user.name || `${billing.first_name || ''} ${billing.last_name || ''}`.trim(),
        existingCustomerId,
        paymentMethodId,
        items,
        address,
        shipping: context.shipping || {},
        currency: catalogPricing && catalogPricing.currency ? catalogPricing.currency : 'usd',
        promotionCodeId,
        subscriptionTermMonths: termMonths,
        attemptId,
        checkoutContextFingerprint: fingerprint,
        idempotencyKey: buildSubscriptionCreateIdempotencyKey({
          userId,
          email,
          items,
          attemptId,
          promotionCodeId
        })
      });

      if (this.customerStore && created.customerId) {
        await this.customerStore.saveCustomerId(userId, created.customerId);
      }

      const checkout = this.decorateCheckout({
        checkout: created.checkout || {},
        billing,
        email,
        eligibility,
        appliedPercent,
        promotion,
        catalogPricing,
        attemptId,
        fingerprint,
        petIds: currentPetIds,
        reused: false
      });

      await this.upsertLedger({
        userId,
        checkout,
        created,
        items,
        nextPlanSelection,
        context,
        termMonths,
        email: checkout.billing.email
      });

      const data = await this.persistCheckout({
        userId,
        payload,
        paymentMethodId,
        billing,
        eligibility,
        appliedPercent,
        promotion,
        nextPlanSelection,
        shipping: context.shipping || {},
        checkout
      });

      return { success: true, data: presentCheckout(data) };
    } finally {
      releaseLock();
    }
  }

  async ensurePricedPlanSelection(userId, context = {}) {
    if (isPricedPlanSelection(context.planSelection) || !canResolvePlanSelection(context.planSelection)) {
      return context;
    }

    if (!this.planPreviewRepository) {
      return context;
    }

    const planSelection = context.planSelection || {};
    const address = context.address || {};
    const market = resolveMarket({
      country: address.country || planSelection.country
    });
    const resolved = await this.planPreviewRepository.previewPlan(userId, {
      subscription_term_months: planSelection.subscription_term_months,
      pets: planSelection.pets,
      country: market.country
    }, market);

    return {
      ...context,
      planSelection: {
        ...planSelection,
        ...resolved,
        pets: planSelection.pets,
        catalog_pricing: resolved.catalog_pricing,
        flavors_by_pet: resolved.flavors_by_pet,
        country: market.country,
        currency: market.currency
      }
    };
  }

  decorateCheckout({
    checkout,
    billing,
    email,
    eligibility,
    appliedPercent,
    promotion,
    catalogPricing,
    attemptId,
    fingerprint,
    petIds,
    reused
  }) {
    return {
      ...checkout,
      order_id: 0,
      billing: {
        first_name: billing.first_name || '',
        last_name: billing.last_name || '',
        email: billing.email || email || '',
        phone: billing.phone || '',
        company: billing.company || ''
      },
      checkout_mode: CHECKOUT_MODE,
      discount_eligibility: eligibility,
      discount_applied_percent: appliedPercent,
      stripe_promotion_code_id: promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null,
      stripe_coupon_id: null,
      stripe_discount_percent: appliedPercent,
      stripe_discount_amount: Number(
        (
          Number(catalogPricing && catalogPricing.subtotal || 0)
          - Number(catalogPricing && catalogPricing.discounted_first_month_total || 0)
        ).toFixed(2)
      ),
      stripe_discount_duration: promotion ? promotion.discount_duration : null,
      discounts: promotion && promotion.promotion_code_id
        ? [{ promotion_code: promotion.promotion_code_id }]
        : [],
      attempt_id: attemptId,
      checkout_context_fingerprint: fingerprint,
      promotion_code_id: promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null,
      pet_ids: Array.isArray(petIds) ? petIds : [],
      reused: Boolean(reused)
    };
  }

  async buildReusedCheckout({
    storedReference,
    paymentMethodId,
    billing,
    user,
    email,
    eligibility,
    appliedPercent,
    promotion,
    catalogPricing,
    attemptId,
    fingerprint,
    petIds
  }) {
    let paymentIntentStatus = String(storedReference.stripe_payment_intent_status || '');
    let clientSecret = storedReference.stripe_client_secret || '';
    if (this.stripeBilling.retrievePaymentIntent && storedReference.stripe_payment_intent_id) {
      try {
        const paymentIntent = await this.stripeBilling.retrievePaymentIntent(
          storedReference.stripe_payment_intent_id
        );
        paymentIntentStatus = String(paymentIntent && paymentIntent.status || paymentIntentStatus);
        clientSecret = (paymentIntent && paymentIntent.client_secret) || clientSecret;
      } catch (_error) {
        // Keep persisted PI fields when retrieve fails; reuse still returns the stored secret.
      }
    }

    const paymentState = this.stripeBilling.resolvePaymentState({
      paymentMethodId,
      paymentIntentStatus,
      clientSecret,
      subscriptionId: storedReference.stripe_subscription_id
    });

    return this.decorateCheckout({
      checkout: {
        ...storedReference,
        stripe_payment_intent_status: paymentIntentStatus,
        stripe_client_secret: clientSecret,
        payment_state: paymentState,
        has_payment_method: true
      },
      billing,
      email: email || (user && user.email),
      eligibility,
      appliedPercent,
      promotion,
      catalogPricing,
      attemptId,
      fingerprint,
      petIds,
      reused: true
    });
  }

  async collectSubscribedPetIds(userId, storedReference = {}) {
    const ids = collectPetIdsFromSnapshot(
      { pet_ids: storedReference.pet_ids, pets: storedReference.pets },
      storedReference.plan_selection || {}
    );

    if (!this.ledgerRepository || !userId) {
      return ids;
    }

    const rows = await this.ledgerRepository.listByUserId(userId);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!SUBSCRIBED_PET_STATUSES.has(String(row.status || ''))) {
        continue;
      }
      ids.push(...collectPetIdsFromSnapshot(row.petsSnapshot || {}, row.planSelection || {}));
    }

    return ids;
  }

  async upsertLedger({
    userId,
    checkout,
    created,
    items,
    nextPlanSelection,
    context,
    termMonths,
    email
  }) {
    if (!this.ledgerRepository || !checkout.stripe_subscription_id) {
      return;
    }

    const existing = await this.ledgerRepository.listByUserId(userId);
    const period = extractSubscriptionPeriod(created.subscription || {});
    const firstItem = Array.isArray(items) ? items[0] : null;
    await this.ledgerRepository.upsert({
      userId,
      customerEmail: email,
      stripeSubscriptionId: checkout.stripe_subscription_id,
      stripeCustomerId: created.customerId,
      status: String((created.subscription && created.subscription.status) || checkout.status || 'incomplete'),
      planLabel: `Plan #${existing.length + 1}`,
      stripePriceId: firstItem && firstItem.price ? firstItem.price : null,
      currentPeriodStart: period.start,
      currentPeriodEnd: period.end,
      cancelAtPeriodEnd: Boolean(created.subscription && created.subscription.cancel_at_period_end),
      petsSnapshot: buildPetsSnapshot(nextPlanSelection, context.pets),
      planSelection: nextPlanSelection,
      shipping: context.shipping || {},
      address: context.address || {},
      subscriptionTermMonths: Number.isFinite(termMonths) ? termMonths : null
    });
  }

  persistCheckout({
    userId,
    payload,
    paymentMethodId,
    billing,
    eligibility,
    appliedPercent,
    promotion,
    nextPlanSelection,
    shipping,
    checkout
  }) {
    return this.repository.checkout(userId, {
      ...payload,
      payment_method_id: paymentMethodId,
      paymentMethodId,
      checkout_mode: CHECKOUT_MODE,
      billing,
      discount_eligibility: eligibility,
      discount_applied_percent: appliedPercent,
      stripe_promotion_code_id: promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null,
      stripe_discount_duration: promotion ? promotion.discount_duration : null,
      plan_selection: nextPlanSelection,
      shipping,
      checkout
    });
  }
}

module.exports = {
  OnboardingSubscriptionCheckoutService,
  getPaymentMethodId,
  getCheckoutMode
};
