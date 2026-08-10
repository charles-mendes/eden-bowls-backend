const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding payment methods routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns saved payment methods for a valid session', async () => {
    const onboardingPaymentMethodsService = {
      listSavedPaymentMethods: jest.fn().mockResolvedValue({
        success: true,
        data: [
          {
            id: 'pm_123',
            brand: 'visa',
            last4: '4242',
            exp_month: 12,
            exp_year: 2028,
            is_default: true
          }
        ]
      })
    };

    const app = createApp({ onboardingPaymentMethodsService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/session/session-123/payment-methods')
      .set('x-session-token', 'token-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: [
        {
          id: 'pm_123',
          brand: 'visa',
          last4: '4242',
          exp_month: 12,
          exp_year: 2028,
          is_default: true
        }
      ]
    });
    expect(onboardingPaymentMethodsService.listSavedPaymentMethods).toHaveBeenCalledWith({
      sessionId: 'session-123',
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPaymentMethodsService = {
      listSavedPaymentMethods: jest.fn()
    };

    const app = createApp({ onboardingPaymentMethodsService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/session/session-123/payment-methods');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPaymentMethodsService.listSavedPaymentMethods).not.toHaveBeenCalled();
  });
});
