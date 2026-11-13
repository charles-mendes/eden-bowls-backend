// checkout-history: the checkout as it was sent, frozen on the subscription's ledger row.
// Edits and webhooks never touch it; the admin "Checkout" tab lists one per subscription.

const CHECKOUT_SNAPSHOT_VERSION = 1;

// Fields that must not leave the checkout flow: they unlock payment confirmation or a session.
const SECRET_REFERENCE_KEYS = ['stripe_client_secret', 'session_id'];

function sanitizeCheckoutReference(reference) {
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) {
    return null;
  }
  const copy = { ...reference };
  for (const key of SECRET_REFERENCE_KEYS) {
    delete copy[key];
  }
  return copy;
}

function objectOrNull(value) {
  return value && typeof value === 'object' ? value : null;
}

function buildCheckoutSnapshot({
  source = 'checkout',
  capturedAt = new Date(),
  checkoutReference,
  planSelection,
  petsSnapshot,
  address,
  shipping,
  recurrence,
  subscriptionTermMonths
} = {}) {
  return {
    version: CHECKOUT_SNAPSHOT_VERSION,
    source,
    captured_at: capturedAt ? new Date(capturedAt).toISOString() : null,
    checkout_reference: sanitizeCheckoutReference(checkoutReference),
    plan_selection: objectOrNull(planSelection),
    pets_snapshot: objectOrNull(petsSnapshot),
    address: objectOrNull(address),
    shipping: objectOrNull(shipping),
    recurrence: objectOrNull(recurrence),
    subscription_term_months: Number.isFinite(Number(subscriptionTermMonths)) && subscriptionTermMonths !== null
      ? Number(subscriptionTermMonths)
      : null
  };
}

// Key-order independent JSON comparison, for checking that two stored copies are the same value.
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function sameJson(left, right) {
  return stableStringify(left == null ? null : left) === stableStringify(right == null ? null : right);
}

module.exports = {
  CHECKOUT_SNAPSHOT_VERSION,
  buildCheckoutSnapshot,
  sanitizeCheckoutReference,
  sameJson
};
