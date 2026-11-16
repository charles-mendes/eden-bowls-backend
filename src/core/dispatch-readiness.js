// Why a paid box is not ready to leave, shared by the courier dispatch and the UPS label purchase. Both answer 409
// with these reasons until the operator confirms.
const DISPATCHABLE_SUBSCRIPTION = new Set(['active', 'trialing']);

function readinessReasons({ productionStatus = null, subscriptionStatus = null } = {}) {
  const reasons = [];
  if (productionStatus !== 'ready') {
    reasons.push({ code: 'production_not_ready', production_status: productionStatus });
  }
  if (!DISPATCHABLE_SUBSCRIPTION.has(String(subscriptionStatus || ''))) {
    reasons.push({ code: 'subscription_not_active', subscription_status: subscriptionStatus || null });
  }
  return reasons;
}

// The paid cycle of the invoice decides the production status; without one the box is not ready.
async function invoiceReadinessReasons(ledgerRepository, subscription, invoiceId) {
  let cycle = null;
  if (ledgerRepository && typeof ledgerRepository.listPaidCyclesByInvoiceIds === 'function') {
    [cycle = null] = await ledgerRepository.listPaidCyclesByInvoiceIds([invoiceId]);
  }
  return readinessReasons({
    productionStatus: cycle ? cycle.productionStatus : null,
    subscriptionStatus: subscription ? subscription.status : null
  });
}

module.exports = { DISPATCHABLE_SUBSCRIPTION, invoiceReadinessReasons, readinessReasons };
