const {
  buildCheckoutFingerprint,
  buildSubscriptionCreateIdempotencyKey,
  createCheckoutLockStore,
  evaluateCheckoutReuse,
  resolveAttemptId
} = require('../src/core/checkout-idempotency');

describe('checkout-idempotency', () => {
  test('builds a stable fingerprint that includes shipping and address', () => {
    const input = {
      userId: 7,
      currency: 'USD',
      subtotal: 40,
      discountedFirstMonthTotal: 36,
      subscriptionTermMonths: 1,
      lineItems: [{ stripe_price_id: 'price_b', quantity: 1 }, { stripe_price_id: 'price_a', quantity: 2 }],
      pets: [{ id: 2 }, { id: 1 }],
      shipping: { rate_id: 'fixed_us:default', method_id: 'flat', cost: 12.9 },
      address: { country: 'US', zipcode: '94105', state: 'CA' },
      promotionCodeId: 'promo_1m'
    };

    const first = buildCheckoutFingerprint(input);
    const second = buildCheckoutFingerprint({
      ...input,
      lineItems: [{ stripe_price_id: 'price_a', quantity: 2 }, { stripe_price_id: 'price_b', quantity: 1 }],
      pets: [{ id: 1 }, { id: 2 }]
    });
    const changedShipping = buildCheckoutFingerprint({
      ...input,
      shipping: { ...input.shipping, cost: 20 }
    });

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(changedShipping).not.toBe(first);
  });

  test('changes the fingerprint when the checkout is for another UUID pet', () => {
    const input = {
      userId: 5,
      currency: 'BRL',
      subtotal: 450,
      subscriptionTermMonths: 1,
      lineItems: [{ stripe_price_id: 'price_br', quantity: 1 }],
      pets: ['10d9b8f8-e879-46dc-888f-fb608427f460'],
      shipping: { rate_id: 'distance_km:br-default', method_id: 'distance_km', cost: 2.47 },
      address: { country: 'BR', zipcode: '83330-030', state: 'PR' }
    };

    expect(buildCheckoutFingerprint({
      ...input,
      pets: ['730521c0-432a-4b71-9978-93d4b224bebc']
    })).not.toBe(buildCheckoutFingerprint(input));
  });

  test('reuses a stored attempt id when the fingerprint matches', () => {
    expect(resolveAttemptId({
      payloadAttemptId: '',
      storedAttemptId: 'attempt-1',
      fingerprintMatches: true
    })).toBe('attempt-1');
    expect(resolveAttemptId({
      payloadAttemptId: 'attempt-front',
      storedAttemptId: 'attempt-1',
      fingerprintMatches: false
    })).toBe('attempt-front');
  });

  test('reuses an incomplete subscription only when the fingerprint matches', () => {
    const reference = {
      stripe_subscription_id: 'sub_123',
      status: 'incomplete',
      stripe_payment_intent_status: 'requires_confirmation',
      checkout_context_fingerprint: 'abc'
    };

    expect(evaluateCheckoutReuse(reference, 'abc')).toEqual({ reuse: true, reason: 'incomplete' });
    expect(evaluateCheckoutReuse(reference, 'other')).toEqual({ reuse: false });
  });

  test('rejects reuse of a paid subscription when the fingerprint changed', () => {
    expect(() => evaluateCheckoutReuse({
      stripe_subscription_id: 'sub_123',
      status: 'active',
      stripe_payment_intent_status: 'succeeded',
      checkout_context_fingerprint: 'abc'
    }, 'other')).toThrow(expect.objectContaining({
      statusCode: 409,
      details: { code: 'checkout_context_mismatch' }
    }));
  });

  test('creates a new subscription when a paid checkout covers a different pet', () => {
    expect(evaluateCheckoutReuse({
      stripe_subscription_id: 'sub_123',
      status: 'active',
      stripe_payment_intent_status: 'succeeded',
      checkout_context_fingerprint: 'abc'
    }, 'other', {
      currentPetIds: ['pet-2'],
      subscribedPetIds: ['pet-1']
    })).toEqual({ reuse: false, reason: 'new_pets' });
  });

  test('does not reuse a paid checkout with a matching fingerprint for an unsubscribed pet', () => {
    expect(evaluateCheckoutReuse({
      stripe_subscription_id: 'sub_123',
      status: 'active',
      stripe_payment_intent_status: 'succeeded',
      checkout_context_fingerprint: 'abc'
    }, 'abc', {
      currentPetIds: ['pet-2'],
      subscribedPetIds: ['pet-1']
    })).toEqual({ reuse: false, reason: 'new_pets' });
  });

  test('still rejects a paid checkout when the same pets change context', () => {
    expect(() => evaluateCheckoutReuse({
      stripe_subscription_id: 'sub_123',
      status: 'active',
      stripe_payment_intent_status: 'succeeded',
      checkout_context_fingerprint: 'abc'
    }, 'other', {
      currentPetIds: ['pet-1'],
      subscribedPetIds: ['pet-1']
    })).toThrow(expect.objectContaining({
      statusCode: 409,
      details: { code: 'checkout_context_mismatch' }
    }));
  });

  test('builds a Stripe idempotency key from user, items and attempt', () => {
    const key = buildSubscriptionCreateIdempotencyKey({
      userId: 7,
      email: 'jane@example.com',
      items: [{ price: 'price_abc', quantity: 1 }],
      attemptId: 'attempt-1',
      promotionCodeId: 'promo_1m'
    });

    expect(key).toMatch(/^eb-sub-create-c2-7-[a-f0-9]{16}-[a-f0-9]{16}-[a-f0-9]{16}-[a-f0-9]{12}$/);
  });

  test('serializes concurrent creates for the same fingerprint', () => {
    const store = createCheckoutLockStore(50);
    const release = store.acquire(7, 'fingerprint-value');

    expect(() => store.acquire(7, 'fingerprint-value')).toThrow(expect.objectContaining({
      statusCode: 409,
      details: { code: 'concurrent_subscription_create' }
    }));

    release();
    expect(() => store.acquire(7, 'fingerprint-value')).not.toThrow();
  });
});
