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
    const payload = { billing: { first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com' }, paymentMethodId: 'pm_123', checkout_mode: 'subscription_first' };
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn().mockResolvedValue({
        success: true,
        data: { order_id: 101, order_key: 'order-key', status: 'pending', total: 29.99, currency: 'USD', payment_state: 'requires_confirmation' }
      })
    };
    const app = createApp({ onboardingSubscriptionCheckoutService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
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
        attempt_id: undefined
      }
    });
  });

  test('rejects checkout without a payment method', async () => {
    const onboardingSubscriptionCheckoutService = { checkout: jest.fn() };
    const app = createApp({ onboardingSubscriptionCheckoutService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/subscription/checkout')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ billing: { first_name: 'Jane' } });

    expect(response.status).toBe(422);
    expect(response.body.details.code).toBe('invalid_payment_method');
    expect(onboardingSubscriptionCheckoutService.checkout).not.toHaveBeenCalled();
  });

  test('requires bearer authentication', async () => {
    const onboardingSubscriptionCheckoutService = { checkout: jest.fn() };
    const app = createApp({ onboardingSubscriptionCheckoutService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/subscription/checkout').send({});

    expect(response.status).toBe(401);
    expect(onboardingSubscriptionCheckoutService.checkout).not.toHaveBeenCalled();
  });
});
