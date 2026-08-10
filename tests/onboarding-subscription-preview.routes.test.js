const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding subscription preview routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a subscription preview for a valid US session', async () => {
    const onboardingSubscriptionPreviewService = {
      preview: jest.fn().mockResolvedValue({
        success: true,
        data: {
          subtotal: 25,
          tax: 2.5,
          total: 27.5,
          currency: 'usd'
        }
      })
    };

    const app = createApp({
      onboardingSubscriptionPreviewService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/subscription/preview')
      .set('x-session-token', 'token-123')
      .send({
        address: {
          country: 'US',
          state: 'CA',
          postal_code: '94105'
        },
        price_ids: ['price_123']
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        subtotal: 25,
        tax: 2.5,
        total: 27.5,
        currency: 'usd'
      }
    });
    expect(onboardingSubscriptionPreviewService.preview).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        address: {
          country: 'US',
          state: 'CA',
          postal_code: '94105'
        },
        price_ids: ['price_123']
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingSubscriptionPreviewService = {
      preview: jest.fn()
    };

    const app = createApp({
      onboardingSubscriptionPreviewService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/subscription/preview')
      .send({ address: { country: 'US', state: 'CA', postal_code: '94105' } });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingSubscriptionPreviewService.preview).not.toHaveBeenCalled();
  });
});
