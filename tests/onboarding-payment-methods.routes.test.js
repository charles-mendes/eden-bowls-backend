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

describe('onboarding payment methods routes', () => {
  test('returns payment methods for the authenticated user', async () => {
    const onboardingPaymentMethodsService = {
      listSavedPaymentMethods: jest.fn().mockResolvedValue({
        success: true,
        data: [{ id: 'pm_123', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2028, is_default: true }]
      })
    };
    const app = createApp({ onboardingPaymentMethodsService, corsOrigins, jwt });

    const response = await request(app)
      .get('/api/v1/onboarding/payment-methods')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(onboardingPaymentMethodsService.listSavedPaymentMethods).toHaveBeenCalledWith({ userId: 7 });
  });

  test('requires bearer authentication', async () => {
    const onboardingPaymentMethodsService = { listSavedPaymentMethods: jest.fn() };
    const app = createApp({ onboardingPaymentMethodsService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/onboarding/payment-methods');

    expect(response.status).toBe(401);
    expect(onboardingPaymentMethodsService.listSavedPaymentMethods).not.toHaveBeenCalled();
  });
});
