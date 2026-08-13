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

describe('onboarding subscription preview routes', () => {
  test('returns a subscription preview for an authenticated US user', async () => {
    const payload = { address: { country: 'US', state: 'CA', postal_code: '94105' }, price_ids: ['price_123'] };
    const onboardingSubscriptionPreviewService = {
      preview: jest.fn().mockResolvedValue({ success: true, data: { subtotal: 25, tax: 2.5, total: 27.5, currency: 'usd' } })
    };
    const app = createApp({ onboardingSubscriptionPreviewService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/subscription/preview')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(27.5);
    expect(onboardingSubscriptionPreviewService.preview).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('requires bearer authentication', async () => {
    const onboardingSubscriptionPreviewService = { preview: jest.fn() };
    const app = createApp({ onboardingSubscriptionPreviewService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/subscription/preview').send({});

    expect(response.status).toBe(401);
    expect(onboardingSubscriptionPreviewService.preview).not.toHaveBeenCalled();
  });
});
