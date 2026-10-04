const CYCLE_BILLING_REASONS = new Set(['subscription_create', 'subscription_cycle']);

// Stripe fallback rule: a skipped cycle is a $0 trial invoice, so only a paid amount above zero counts.
function stripeChargedInvoiceCount(invoices = []) {
  return invoices.filter((invoice) => invoice.status === 'paid'
    && CYCLE_BILLING_REASONS.has(invoice.billing_reason)
    && Number(invoice.amount_paid) > 0).length;
}

// Ledger rule: the cycle price before discounts, so a 100% coupon still counts and a $0 trial invoice does not.
function isChargedDeliveryInvoice(invoice = {}) {
  return CYCLE_BILLING_REASONS.has(invoice.billing_reason) && Number(invoice.subtotal) > 0;
}

// Charged deliveries inside the current contract. With automatic renewal on, a finished contract rolls
// into the next one at the following renewal; with it off, a finished contract stays finished.
function contractChargedCount(paidDeliveries, termMonths, autoRenew) {
  if (paidDeliveries == null) return null;
  const paid = Math.max(0, Number(paidDeliveries) || 0);
  const term = Math.max(1, Number(termMonths) || 1);
  if (autoRenew) return paid % term;
  return paid === 0 ? 0 : ((paid - 1) % term) + 1;
}

function lastContractedDeliveryCharged(paidDeliveries, termMonths) {
  const paid = Number(paidDeliveries) || 0;
  const term = Math.max(1, Number(termMonths) || 1);
  return paid > 0 && paid % term === 0;
}

function resolveAutoRenew(row = {}) {
  if (row.autoRenew === true || row.autoRenew === false) return row.autoRenew;
  return !row.cancelAtPeriodEnd;
}

module.exports = {
  CYCLE_BILLING_REASONS,
  contractChargedCount,
  isChargedDeliveryInvoice,
  lastContractedDeliveryCharged,
  resolveAutoRenew,
  stripeChargedInvoiceCount
};
