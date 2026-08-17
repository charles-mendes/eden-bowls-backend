const { HttpError } = require('../core/http-error');
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
    const planSelection = this.repository.getPlanSelection
      ? await this.repository.getPlanSelection(userId)
      : null;
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
      plan_selection: nextPlanSelection
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
