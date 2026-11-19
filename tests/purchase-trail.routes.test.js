const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { HttpError } = require('../src/core/http-error');
const { CustomerPurchaseTrailService } = require('../src/services/customer-purchase-trail.service');

const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const CORRELATION = '6f1c2a34-5b6d-4e7f-8a9b-0c1d2e3f4a5b';

function token(userId) {
  return issueJwtToken({ data: { user: { id: userId, email: 'c@example.com' } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 30));
}

function fakeRepository() {
  let nextId = 1;
  const attempts = new Map();
  const repository = {
    attempts,
    events: [],
    openAttempt: jest.fn(async (row) => {
      const key = `${row.user_id}|${row.market}|${row.correlation_id}`;
      if (!attempts.has(key)) {
        attempts.set(key, { id: nextId++, status: 'in_progress', ...row });
      } else {
        const current = attempts.get(key);
        for (const [field, value] of Object.entries(row)) {
          if (value != null) current[field] = value;
        }
      }
      return attempts.get(key).id;
    }),
    insertEvent: jest.fn(async (row) => { repository.events.push(row); return 1; }),
    transitionAttempt: jest.fn(async (id, transition) => {
      const row = [...attempts.values()].find((item) => item.id === id);
      if (!row || row.status === 'paid') return 0;
      row.status = transition;
      return 1;
    }),
    findAttemptByAttemptId: jest.fn(async ({ userId, market, attemptId }) => [...attempts.values()]
      .find((row) => row.user_id === userId && row.market === market && row.attempt_id === attemptId) || null)
  };
  return repository;
}

function setup({ address = null, ledgerRow = null, repository = fakeRepository(), ...services } = {}) {
  const ledgerRepository = {
    findUserStateByUserId: jest.fn(async () => (address ? { address } : null)),
    findByUserIdAndSubscriptionId: jest.fn(async () => ledgerRow)
  };
  const customerPurchaseTrailService = new CustomerPurchaseTrailService({ repository, ledgerRepository });
  const app = createApp({ jwt, corsOrigins: [], customerPurchaseTrailService, ...services });
  return { app, repository };
}

const CHECKOUT = { payment_method_id: 'pm_123', legal_consent: { accepted: true }, renewal_consent: { accepted: true } };

const PET = {
  name: 'Milo', breed: 'Labrador', age_years: 2, age_months: 0, weight: 10, weight_unit: 'kg',
  size: 'large', activity_level: 'high', pet_condition: 'ideal', neutered: true
};

// customer-purchase-trail
describe('purchase trail on store routes', () => {
  test('a pet failure writes user, market and error code, without the pet sheet', async () => {
    const onboardingPetCreateService = { createPet: jest.fn().mockRejectedValue(new HttpError(422, 'Pet limit reached.', { code: 'pet_limit_reached' })) };
    const { app, repository } = setup({ onboardingPetCreateService });
    const response = await request(app)
      .post('/api/v1/onboarding/pets')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'BR')
      .set('X-Purchase-Correlation-Id', CORRELATION)
      .send(PET);
    expect(response.status).toBe(422);
    await flush();
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({ user_id: 5, market: 'br', area: 'onboarding', step: 'pet', action: 'create', outcome: 'failed', error_code: 'pet_limit_reached', http_status: 422 });
    expect(JSON.stringify(repository.events)).not.toContain('Labrador');
  });

  test('a 401 for an identified customer writes only the status and code', async () => {
    const onboardingPetCreateService = { createPet: jest.fn().mockRejectedValue(new HttpError(401, 'Session expired.', { code: 'unauthorized' })) };
    const { app, repository } = setup({ onboardingPetCreateService });
    await request(app).post('/api/v1/onboarding/pets').set('Authorization', `Bearer ${token(5)}`).set('X-Eden-Country', 'US').send({ ...PET, password: 'hunter2', otp: '123456' });
    await flush();
    expect(repository.events[0]).toMatchObject({ http_status: 401, error_code: 'unauthorized', step: 'pet' });
    expect(JSON.stringify(repository.events)).not.toMatch(/hunter2|123456|Bearer/);
  });

  test('a plan failure keeps the code even when the answer leaves it out', async () => {
    const onboardingRecurrenceService = { setRecurrence: jest.fn().mockRejectedValue(new HttpError(422, 'Invalid term.', { code: 'invalid_term' })) };
    const { app, repository } = setup({ onboardingRecurrenceService });
    const response = await request(app)
      .post('/api/v1/onboarding/recurrence')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .send({ subscription_term_months: 3 });
    expect(response.status).toBe(422);
    expect(response.body.details).toBeUndefined();
    await flush();
    expect(repository.events[0]).toMatchObject({ user_id: 5, market: 'us', area: 'plan', step: 'recurrence', error_code: 'invalid_term' });
    expect([...repository.attempts.values()][0]).toMatchObject({ term_months: 3, currency: 'USD', status: 'in_progress' });
  });

  test('the address country wins over the page market', async () => {
    const onboardingShippingSelectService = { selectShipping: jest.fn().mockRejectedValue(new HttpError(409, 'No rate.', { code: 'shipping_unavailable' })) };
    const { app, repository } = setup({ address: { country: 'US' }, onboardingShippingSelectService });
    await request(app).post('/api/v1/onboarding/shipping').set('Authorization', `Bearer ${token(5)}`).set('X-Eden-Country', 'BR').send({});
    await flush();
    expect(repository.events[0]).toMatchObject({ market: 'us', step: 'shipping' });
  });

  test('without a market, or without a customer, nothing is written', async () => {
    const onboardingZipcodeService = { setZipcode: jest.fn().mockResolvedValue({ success: true }) };
    const { app, repository } = setup({ onboardingZipcodeService });
    await request(app).post('/api/v1/onboarding/address').set('Authorization', `Bearer ${token(5)}`).send({});
    const unauthenticated = await request(app).post('/api/v1/onboarding/address').set('X-Eden-Country', 'BR').send({});
    expect(unauthenticated.status).toBe(401);
    await flush();
    expect(repository.openAttempt).not.toHaveBeenCalled();
  });

  test('a checkout validation failure is an event and the attempt stays in progress', async () => {
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn().mockRejectedValue(new HttpError(409, 'Coupon changed.', { code: 'first_purchase_promo_not_configured' }))
    };
    const { app, repository } = setup({ onboardingSubscriptionCheckoutService });
    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .set('X-Purchase-Correlation-Id', CORRELATION)
      .send({ ...CHECKOUT, payment_method_id: 'pm_secret_1', client_secret: 'pi_1_secret_2', tax_document: '12345678900' });
    expect(response.status).toBe(409);
    await flush();
    expect(repository.events[0]).toMatchObject({ market: 'us', step: 'subscription_checkout', error_code: 'first_purchase_promo_not_configured', http_status: 409 });
    expect([...repository.attempts.values()][0].status).toBe('in_progress');
    const written = JSON.stringify([...repository.attempts.values(), ...repository.events]);
    expect(written).not.toContain('pm_secret_1');
    expect(written).not.toContain('secret_2');
    expect(written).not.toContain('12345678900');
  });

  test('the Stripe subscription failing closes the attempt failed with the Stripe fields', async () => {
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn().mockRejectedValue(new HttpError(502, 'Your card was declined.', {
        code: 'stripe_subscription_failed', stripe_code: 'card_declined', stripe_type: 'card_error', stripe_param: 'payment_method'
      }))
    };
    const { app, repository } = setup({ onboardingSubscriptionCheckoutService });
    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'BR')
      .send(CHECKOUT);
    expect(response.status).toBe(502);
    await flush();
    expect(repository.events[0]).toMatchObject({ stripe_code: 'card_declined', stripe_type: 'card_error', stripe_param: 'payment_method', market: 'br' });
    expect([...repository.attempts.values()][0].status).toBe('failed');
  });

  test('a failing trail insert leaves the checkout status and code unchanged', async () => {
    const repository = fakeRepository();
    repository.openAttempt.mockRejectedValue(new Error('db down'));
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn().mockRejectedValue(new HttpError(409, 'Coupon changed.', { code: 'invalid_coupon' }))
    };
    const { app } = setup({ repository, onboardingSubscriptionCheckoutService });
    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .send(CHECKOUT);
    await flush();
    expect(response.status).toBe(409);
    expect(response.body.details.code).toBe('invalid_coupon');
  });

  test('a zipcode error, then a 200 ack, ends paid in one attempt', async () => {
    const onboardingZipcodeLookupService = { lookup: jest.fn().mockRejectedValue(new HttpError(422, 'Invalid zipcode.', { code: 'invalid_zipcode' })) };
    const onboardingPaymentIntentAckService = { acknowledge: jest.fn().mockResolvedValue({ success: true }) };
    const { app, repository } = setup({ onboardingZipcodeLookupService, onboardingPaymentIntentAckService });
    const auth = (call) => call.set('Authorization', `Bearer ${token(5)}`).set('X-Eden-Country', 'BR').set('X-Purchase-Correlation-Id', CORRELATION);
    await auth(request(app).post('/api/v1/onboarding/zipcode/lookup')).send({ zipcode: '1' });
    await flush();
    await auth(request(app).post('/api/v1/onboarding/payment-intent/ack')).send({ payment_intent_id: 'pi_1', attempt_id: 'att_1' });
    await flush();
    expect(repository.attempts.size).toBe(1);
    expect(repository.events.map((event) => [event.step, event.outcome])).toEqual([['zipcode_lookup', 'failed'], ['payment_intent_ack', 'ok']]);
    expect([...repository.attempts.values()][0]).toMatchObject({ status: 'paid', attempt_id: 'att_1' });
  });

  test('a failed ack keeps the server error code although the answer has no details', async () => {
    const onboardingPaymentIntentAckService = { acknowledge: jest.fn().mockRejectedValue(new HttpError(409, 'Mismatch.', { code: 'payment_intent_mismatch' })) };
    const { app, repository } = setup({ onboardingPaymentIntentAckService });
    const response = await request(app)
      .post('/api/v1/onboarding/payment-intent/ack')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .send({ payment_intent_id: 'pi_1' });
    expect(response.body).toEqual({ success: false, message: 'Mismatch.' });
    await flush();
    expect(repository.events[0]).toMatchObject({ step: 'payment_intent_ack', error_code: 'payment_intent_mismatch' });
    expect([...repository.attempts.values()][0].status).toBe('in_progress');
  });
});

describe('purchase trail client events', () => {
  test('a declined confirmCardPayment is written without the Stripe body and closes failed', async () => {
    const { app, repository } = setup();
    const response = await request(app)
      .post('/api/v1/onboarding/checkout/client-events')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'BR')
      .set('X-Purchase-Correlation-Id', CORRELATION)
      .send({ step: 'confirm_card_payment', outcome: 'failed', stripe_code: 'card_declined', message: 'Cartão recusado.' });
    expect(response.status).toBe(202);
    expect(repository.events[0]).toMatchObject({ user_id: 5, market: 'br', step: 'confirm_card_payment', stripe_code: 'card_declined', error_code: 'card_declined' });
    expect([...repository.attempts.values()][0].status).toBe('failed');
  });

  test('extra keys are dropped and an ok confirmation never marks paid', async () => {
    const { app, repository } = setup();
    await request(app)
      .post('/api/v1/onboarding/checkout/client-events')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .set('X-Purchase-Correlation-Id', CORRELATION)
      .send({ step: 'confirm_card_payment', outcome: 'ok', client_secret: 'pi_9_secret_9', error: { payment_method: 'pm_9' } });
    await request(app)
      .post('/api/v1/onboarding/checkout/client-events')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .set('X-Purchase-Correlation-Id', CORRELATION)
      .send({ step: 'payment_intent_ack', outcome: 'failed', code: 'ack_failed' });
    expect([...repository.attempts.values()][0].status).toBe('in_progress');
    expect(repository.events.map((event) => event.step)).toEqual(['confirm_card_payment', 'payment_intent_ack']);
    expect(JSON.stringify(repository.events)).not.toMatch(/secret|pm_9/);
  });

  test('a Stripe account mismatch seen by the browser is an event, not an end', async () => {
    const { app, repository } = setup();
    await request(app)
      .post('/api/v1/onboarding/checkout/client-events')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .send({ step: 'stripe_account_check', outcome: 'failed', code: 'stripe_account_mismatch' });
    expect(repository.events[0]).toMatchObject({ step: 'stripe_account_check', error_code: 'stripe_account_mismatch', market: 'us' });
    expect([...repository.attempts.values()][0].status).toBe('in_progress');
  });

  test('answers 202 when the trail cannot write', async () => {
    const repository = fakeRepository();
    repository.openAttempt.mockRejectedValue(new Error('db down'));
    const { app } = setup({ repository });
    const response = await request(app)
      .post('/api/v1/onboarding/checkout/client-events')
      .set('Authorization', `Bearer ${token(5)}`)
      .set('X-Eden-Country', 'US')
      .send({ step: 'retrieve_payment_intent', outcome: 'failed' });
    expect(response.status).toBe(202);
  });

  test('needs a customer and a known step', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/onboarding/checkout/client-events').send({ step: 'confirm_card_payment', outcome: 'ok' })).status).toBe(401);
    expect((await request(app).post('/api/v1/onboarding/checkout/client-events').set('Authorization', `Bearer ${token(5)}`).send({ step: 'login', outcome: 'ok' })).status).toBe(400);
  });
});

describe('purchase trail on bought subscriptions', () => {
  test('the market is the ledger Stripe account; a failed commit closes failed and a good one completed', async () => {
    const subscriptionsEditCommitService = {
      commit: jest.fn()
        .mockRejectedValueOnce(new HttpError(409, 'Changed.', { code: 'edit_hash_mismatch' }))
        .mockResolvedValueOnce({ success: true })
    };
    const { app, repository } = setup({ ledgerRow: { stripeAccount: 'br' }, subscriptionsEditCommitService });
    await request(app).post('/api/v1/subscriptions/sub_1/edit/commit').set('Authorization', `Bearer ${token(5)}`).set('X-Eden-Country', 'US').send({});
    await flush();
    await request(app).post('/api/v1/subscriptions/sub_1/edit/commit').set('Authorization', `Bearer ${token(5)}`).send({});
    await flush();
    const attempts = [...repository.attempts.values()];
    expect(attempts.map((row) => [row.market, row.area, row.subscription_id, row.status])).toEqual([
      ['br', 'subscription', 'sub_1', 'failed'],
      ['br', 'subscription', 'sub_1', 'completed']
    ]);
    expect(repository.events[0]).toMatchObject({ step: 'edit_commit', error_code: 'edit_hash_mismatch', subscription_id: 'sub_1' });
  });
});
