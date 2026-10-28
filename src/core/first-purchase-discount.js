// Percents before first_purchase_term_discounts, its seed in both accounts and the fallback without the table.
const TERM_PERCENT_MAP = {
  1: 10,
  3: 25,
  6: 40
};

const VALID_SUBSCRIPTION_TERMS = [1, 3, 6];

const MIN_TERM_PERCENT = 1;
const MAX_TERM_PERCENT = 90;

// Plan terms offered with a Stripe account's percents ({ 1: 10, 3: 25, 6: 40 }).
function planTermsFor(percents = TERM_PERCENT_MAP) {
  return VALID_SUBSCRIPTION_TERMS.map((subscription_term_months) => ({
    subscription_term_months,
    discount_percent: expectedPercentForTerm(subscription_term_months, percents)
  }));
}

const PLAN_TERMS = planTermsFor(TERM_PERCENT_MAP);

function expectedPercentForTerm(termMonths, percents = TERM_PERCENT_MAP) {
  const term = Number(termMonths);
  if (!VALID_SUBSCRIPTION_TERMS.includes(term)) {
    return 0;
  }
  const percent = Number(percents && percents[term]);
  return Number.isInteger(percent) && percent > 0 ? percent : TERM_PERCENT_MAP[term];
}

function isValidSubscriptionTerm(termMonths) {
  return VALID_SUBSCRIPTION_TERMS.includes(Number(termMonths));
}

function isPromoId(value) {
  return typeof value === 'string' && value.startsWith('promo_') && value.length > 6;
}

function applyFirstPurchaseDiscount(subtotal, percent) {
  const base = Number(subtotal);
  const discountPercent = Math.max(0, Number(percent) || 0);

  if (!Number.isFinite(base) || base <= 0) {
    return 0;
  }

  return Number(Math.max(0, base * (1 - discountPercent / 100)).toFixed(2));
}

function discountAmountFromSubtotal(subtotal, percent) {
  const base = Number(subtotal);
  const discounted = applyFirstPurchaseDiscount(base, percent);

  if (!Number.isFinite(base) || base <= 0) {
    return 0;
  }

  return Number(Math.max(0, base - discounted).toFixed(2));
}

module.exports = {
  MAX_TERM_PERCENT,
  MIN_TERM_PERCENT,
  PLAN_TERMS,
  planTermsFor,
  TERM_PERCENT_MAP,
  VALID_SUBSCRIPTION_TERMS,
  applyFirstPurchaseDiscount,
  discountAmountFromSubtotal,
  expectedPercentForTerm,
  isPromoId,
  isValidSubscriptionTerm
};
