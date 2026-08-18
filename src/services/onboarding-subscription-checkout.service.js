const { HttpError } = require('../core/http-error');
const { validateCheckoutState } = require('../core/checkout-state');
const {
  applyFirstPurchaseDiscount,
  expectedPercentForTerm
} = require('../core/first-purchase-discount');

function getPaymentMethodId(payload = {}) {
  return payload.payment_method_id || payload.paymentMethodId || '';
}

function getCheckoutMode(payload = {}) {
  return payload.checkout_mode || payload.flow || 'order_first';
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

class OnboardingSubscriptionCheckoutService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.authService = options.authService || null;
    this.discountEligibilityRepository = options.discountEligibilityRepository || null;
    this.stripeCouponService = options.stripeCouponService || null;
    this.stripeBilling = options.stripeBilling || null;
    this.customerStore = options.customerStore || null;
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

    const eligibility = await this.discountEligibilityRepository.getEligibility(userId);
    const context = this.repository.getCheckoutContext
      ? await this.repository.getCheckoutContext(userId)
      : { planSelection: this.repository.getPlanSelection ? await this.repository.getPlanSelection(userId) : null };
    validateCheckoutState(context);

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

    const paymentMethodId = getPaymentMethodId(payload);
    const checkoutMode = getCheckoutMode(payload);
    const billing = payload.billing || {};
    const items = this.repository.resolveSubscriptionItems
      ? await this.repository.resolveSubscriptionItems(nextPlanSelection)
      : [];

    if (!this.stripeBilling) {
      throw new HttpError(503, 'STRIPE_SECRET_KEY is not configured.', { code: 'stripe_secret_missing' });
    }

    const user = this.repository.getUserEmail
      ? await this.repository.getUserEmail(userId)
      : { email: billing.email || '', name: `${billing.first_name || ''} ${billing.last_name || ''}`.trim() };
    const existingCustomerId = this.customerStore
      ? await this.customerStore.getCustomerId(userId)
      : '';
    const created = await this.stripeBilling.createOnboardingSubscription({
      userId,
      email: billing.email || user.email,
      name: user.name || `${billing.first_name || ''} ${billing.last_name || ''}`.trim(),
      existingCustomerId,
      paymentMethodId,
      items,
      address: context.address || {},
      shipping: context.shipping || {},
      currency: catalogPricing && catalogPricing.currency ? catalogPricing.currency : 'usd',
      promotionCodeId: promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null
    });

    if (this.customerStore && created.customerId) {
      await this.customerStore.saveCustomerId(userId, created.customerId);
    }

    const checkout = {
      ...(created.checkout || {}),
      billing: {
        first_name: billing.first_name || '',
        last_name: billing.last_name || '',
        email: billing.email || user.email || '',
        phone: billing.phone || '',
        company: billing.company || ''
      },
      checkout_mode: checkoutMode,
      discount_eligibility: eligibility,
      discount_applied_percent: appliedPercent,
      stripe_promotion_code_id: promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null,
      stripe_coupon_id: payload.stripe_coupon_id || null,
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
        : []
    };

    const data = await this.repository.checkout(userId, {
      ...payload,
      payment_method_id: paymentMethodId,
      paymentMethodId,
      checkout_mode: checkoutMode,
      billing,
      discount_eligibility: eligibility,
      discount_applied_percent: appliedPercent,
      stripe_promotion_code_id: promotion && promotion.promotion_code_id ? promotion.promotion_code_id : null,
      stripe_discount_duration: promotion ? promotion.discount_duration : null,
      plan_selection: nextPlanSelection,
      shipping: context.shipping || {},
      checkout
    });

    return {
      success: true,
      data
    };
  }
}

module.exports = {
  OnboardingSubscriptionCheckoutService,
  getPaymentMethodId,
  getCheckoutMode
};
