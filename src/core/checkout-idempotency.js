const crypto = require('crypto');
const { canonicalize } = require('./subscription-edit-hash');
const { HttpError } = require('./http-error');

const DEFAULT_LOCK_TTL_MS = 120000;
const REUSABLE_SUBSCRIPTION_STATUSES = new Set(['incomplete']);
const SETTLED_PAYMENT_INTENT_STATUSES = new Set(['succeeded', 'processing', 'requires_capture']);
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const REUSABLE_PAYMENT_INTENT_STATUSES = new Set(['requires_confirmation', 'requires_action']);

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function hashCanonical(value) {
  return sha256Hex(JSON.stringify(canonicalize(value)));
}

function buildCheckoutFingerprint({
  userId,
  currency,
  subtotal,
  discountedFirstMonthTotal,
  subscriptionTermMonths,
  lineItems = [],
  pets = [],
  shipping = {},
  address = {},
  promotionCodeId
} = {}) {
  const items = (Array.isArray(lineItems) ? lineItems : [])
    .map((item) => ({
      price_id: String(item.stripe_price_id || item.price_id || item.price || ''),
      variation_id: Number(item.variation_id || 0),
      quantity: Math.max(1, Number(item.quantity) || 1),
      line_total: Number(item.line_total || item.total || 0)
    }))
    .sort((left, right) => {
      const leftKey = `${left.price_id}:${left.variation_id}`;
      const rightKey = `${right.price_id}:${right.variation_id}`;
      return leftKey.localeCompare(rightKey);
    });

  const petIds = (Array.isArray(pets) ? pets : [])
    .map((pet) => Number(pet && pet.id != null ? pet.id : pet))
    .filter((id) => Number.isFinite(id) && id > 0)
    .sort((left, right) => left - right);

  return hashCanonical({
    user_id: Number(userId || 0),
    currency: String(currency || 'usd').toLowerCase(),
    subtotal: Number(subtotal || 0),
    discounted_first_month_total: Number(discountedFirstMonthTotal || 0),
    subscription_term_months: Number(subscriptionTermMonths || 0),
    line_items: items,
    pets: petIds,
    shipping: {
      rate_id: String(shipping.rate_id || ''),
      method_id: String(shipping.method_id || ''),
      cost: Number(shipping.cost || shipping.total || 0)
    },
    address: {
      country: String(address.country || '').toUpperCase(),
      zipcode: String(address.zipcode || address.postal_code || ''),
      state: String(address.state || '')
    },
    promotion_code_id: String(promotionCodeId || 'none')
  });
}

function resolveAttemptId({ payloadAttemptId, storedAttemptId, fingerprintMatches } = {}) {
  const incoming = String(payloadAttemptId || '').trim();
  if (incoming) {
    return incoming;
  }

  const stored = String(storedAttemptId || '').trim();
  if (stored && fingerprintMatches) {
    return stored;
  }

  return crypto.randomUUID();
}

function buildSubscriptionCreateIdempotencyKey({
  userId,
  email,
  items = [],
  attemptId,
  promotionCodeId
} = {}) {
  const emailHash = sha256Hex(String(email || '').trim().toLowerCase()).slice(0, 16);
  const itemsDigest = hashCanonical(
    (Array.isArray(items) ? items : [])
      .map((item) => ({
        price: String(item.price || ''),
        quantity: Math.max(1, Number(item.quantity) || 1)
      }))
      .sort((left, right) => String(left.price).localeCompare(String(right.price)))
  ).slice(0, 16);
  const attemptHash = sha256Hex(attemptId).slice(0, 16);
  const promoScope = sha256Hex(promotionCodeId || 'none').slice(0, 12);

  return `eb-sub-create-${userId}-${emailHash}-${itemsDigest}-${attemptHash}-${promoScope}`;
}

function fingerprintsMatch(left, right) {
  const stored = String(left || '');
  const current = String(right || '');
  if (!stored || !current || stored.length !== current.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(current));
  } catch (_error) {
    return false;
  }
}

function evaluateCheckoutReuse(checkoutReference = {}, fingerprint = '') {
  const subscriptionId = String(checkoutReference.stripe_subscription_id || '').trim();
  if (!subscriptionId.startsWith('sub_')) {
    return { reuse: false };
  }

  const fingerprintOk = fingerprintsMatch(checkoutReference.checkout_context_fingerprint, fingerprint);
  const subscriptionStatus = String(
    checkoutReference.stripe_subscription_status || checkoutReference.status || ''
  );
  const paymentIntentStatus = String(checkoutReference.stripe_payment_intent_status || '');
  const settled = SETTLED_PAYMENT_INTENT_STATUSES.has(paymentIntentStatus)
    || ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);

  if (settled && !fingerprintOk) {
    throw new HttpError(409, 'Checkout context does not match the existing subscription.', {
      code: 'checkout_context_mismatch'
    });
  }

  if (settled && fingerprintOk) {
    return { reuse: true, reason: 'settled' };
  }

  const reusable = REUSABLE_SUBSCRIPTION_STATUSES.has(subscriptionStatus)
    || REUSABLE_PAYMENT_INTENT_STATUSES.has(paymentIntentStatus);

  if (reusable && fingerprintOk) {
    return { reuse: true, reason: 'incomplete' };
  }

  return { reuse: false };
}

function createCheckoutLockStore(ttlMs = DEFAULT_LOCK_TTL_MS) {
  const locks = new Map();

  function acquire(userId, fingerprint) {
    const key = `checkout-sub-create:${userId}:${String(fingerprint || '').slice(0, 16)}`;
    const now = Date.now();
    const existing = locks.get(key);
    if (existing && existing.expiresAt > now) {
      throw new HttpError(409, 'A subscription create is already in progress.', {
        code: 'concurrent_subscription_create'
      });
    }

    locks.set(key, { expiresAt: now + ttlMs });
    return () => {
      locks.delete(key);
    };
  }

  function clear() {
    locks.clear();
  }

  return { acquire, clear };
}

const defaultCheckoutLockStore = createCheckoutLockStore();

module.exports = {
  DEFAULT_LOCK_TTL_MS,
  buildCheckoutFingerprint,
  buildSubscriptionCreateIdempotencyKey,
  createCheckoutLockStore,
  defaultCheckoutLockStore,
  evaluateCheckoutReuse,
  fingerprintsMatch,
  resolveAttemptId,
  sha256Hex
};
