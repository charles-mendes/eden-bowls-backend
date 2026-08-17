const {
  PLAN_TERMS,
  applyFirstPurchaseDiscount,
  discountAmountFromSubtotal,
  expectedPercentForTerm,
  isPromoId,
  isValidSubscriptionTerm
} = require('../src/core/first-purchase-discount');

describe('first-purchase-discount', () => {
  test('exposes the 10/25/40 catalog used by plan snapshot', () => {
    expect(PLAN_TERMS).toEqual([
      { subscription_term_months: 1, discount_percent: 10 },
      { subscription_term_months: 3, discount_percent: 25 },
      { subscription_term_months: 6, discount_percent: 40 }
    ]);
  });

  test('returns the expected percent for valid terms and 0 otherwise', () => {
    expect(expectedPercentForTerm(1)).toBe(10);
    expect(expectedPercentForTerm(3)).toBe(25);
    expect(expectedPercentForTerm(6)).toBe(40);
    expect(expectedPercentForTerm(12)).toBe(0);
    expect(expectedPercentForTerm(null)).toBe(0);
    expect(isValidSubscriptionTerm(3)).toBe(true);
    expect(isValidSubscriptionTerm(2)).toBe(false);
  });

  test('accepts only Stripe promotion code ids', () => {
    expect(isPromoId('promo_abc123')).toBe(true);
    expect(isPromoId('coupon_abc123')).toBe(false);
    expect(isPromoId('promo_')).toBe(false);
    expect(isPromoId('')).toBe(false);
  });

  test('applies percent-off to the first-month subtotal', () => {
    expect(applyFirstPurchaseDiscount(100, 25)).toBe(75);
    expect(applyFirstPurchaseDiscount(25, 10)).toBe(22.5);
    expect(discountAmountFromSubtotal(25, 10)).toBe(2.5);
    expect(applyFirstPurchaseDiscount(0, 40)).toBe(0);
  });
});
