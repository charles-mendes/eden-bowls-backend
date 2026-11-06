const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding subscription checkout routes', () => {
  test('creates checkout for the authenticated user', async () => {
    const payload = {
      billing: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
      paymentMethodId: 'pm_123',
      checkout_mode: 'subscription_first',
      legal_consent: { accepted: true, terms_version: '2026-10-22', privacy_version: '2026-10-22' }
    };
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn().mockResolvedValue({
        success: true,
        data: { order_id: 101, order_key: 'order-key', status: 'pending', total: 29.99, currency: 'USD', payment_state: 'requires_confirmation' }
      })
    };
    const privacyService = { contextFromRequest: jest.fn().mockReturnValue({ ipHash: 'hash', userAgent: 'jest-agent' }) };
    const app = createApp({ onboardingSubscriptionCheckoutService, privacyService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .set('User-Agent', 'jest-agent')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.order_id).toBe(101);
    expect(onboardingSubscriptionCheckoutService.checkout).toHaveBeenCalledWith({
      userId: 7,
      payload: {
        payment_method_id: 'pm_123',
        paymentMethodId: 'pm_123',
        billing: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' },
        attempt_id: undefined,
        legal_consent: { accepted: true, terms_version: '2026-10-22', privacy_version: '2026-10-22' }
      },
      requestContext: { ipHash: 'hash', userAgent: 'jest-agent' }
    });
    expect(privacyService.contextFromRequest).toHaveBeenCalledWith(expect.objectContaining({ userAgent: 'jest-agent' }));
  });

  test('rejects checkout without a payment method', async () => {
    const onboardingSubscriptionCheckoutService = { checkout: jest.fn() };
    const app = createApp({ onboardingSubscriptionCheckoutService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ billing: { first_name: 'Jane' }, legal_consent: { accepted: true } });

    expect(response.status).toBe(422);
    expect(response.body.details.code).toBe('invalid_payment_method');
    expect(onboardingSubscriptionCheckoutService.checkout).not.toHaveBeenCalled();
  });

  describe('Checkout requires accepting the terms and privacy policy', () => {
    async function post(body) {
      const onboardingSubscriptionCheckoutService = { checkout: jest.fn() };
      const app = createApp({ onboardingSubscriptionCheckoutService, corsOrigins, jwt });
      const response = await request(app)
        .post('/api/v1/onboarding/subscription/checkout')
        .set('Authorization', `Bearer ${issueAccessToken(7)}`)
        .send({ payment_method_id: 'pm_123', ...body });
      return { response, onboardingSubscriptionCheckoutService };
    }

    test.each([
      ['Box not ticked', { legal_consent: { accepted: false, terms_version: '2026-10-22' } }],
      ['Old client without the field', {}],
      ['accepted as a string', { legal_consent: { accepted: 'true' } }],
      ['a version longer than 32 characters', { legal_consent: { accepted: true, terms_version: 'x'.repeat(33) } }]
    ])('%s: 422 legal_consent_required and the service is not called', async (_name, body) => {
      const { response, onboardingSubscriptionCheckoutService } = await post(body);

      expect(response.status).toBe(422);
      expect(response.body.details.code).toBe('legal_consent_required');
      expect(onboardingSubscriptionCheckoutService.checkout).not.toHaveBeenCalled();
    });

    test('without a payment method either, the missing consent answers first', async () => {
      const { response } = await post({ payment_method_id: undefined });
      expect(response.body.details.code).toBe('legal_consent_required');
    });
  });

  test('requires bearer authentication', async () => {
    const onboardingSubscriptionCheckoutService = { checkout: jest.fn() };
    const app = createApp({ onboardingSubscriptionCheckoutService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/subscription/checkout').send({});

    expect(response.status).toBe(401);
    expect(onboardingSubscriptionCheckoutService.checkout).not.toHaveBeenCalled();
  });
});
