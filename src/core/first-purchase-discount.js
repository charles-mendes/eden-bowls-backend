const TERM_PERCENT_MAP = {
  1: 10,
  3: 25,
  6: 40
};

const VALID_SUBSCRIPTION_TERMS = [1, 3, 6];

const PLAN_TERMS = VALID_SUBSCRIPTION_TERMS.map((subscription_term_months) => ({
  subscription_term_months,
  discount_percent: TERM_PERCENT_MAP[subscription_term_months]
}));

function expectedPercentForTerm(termMonths) {
  const term = Number(termMonths);
  if (!Object.prototype.hasOwnProperty.call(TERM_PERCENT_MAP, term)) {
    return 0;
  }

  return TERM_PERCENT_MAP[term];
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
  PLAN_TERMS,
  TERM_PERCENT_MAP,
  VALID_SUBSCRIPTION_TERMS,
  applyFirstPurchaseDiscount,
  discountAmountFromSubtotal,
  expectedPercentForTerm,
  isPromoId,
  isValidSubscriptionTerm
};
