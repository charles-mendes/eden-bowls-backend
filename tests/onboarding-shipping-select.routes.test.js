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

describe('onboarding shipping routes', () => {
  test('persists a shipping selection for the authenticated user', async () => {
    const payload = { rate_id: 'rate-1', method_id: 'method-1', label: 'Express Delivery', cost: 5, tax_total: 0.5, total: 5.5, instance_id: 1, transit_business_days: 2, zipcode: '94105' };
    const onboardingShippingSelectService = {
      selectShipping: jest.fn().mockResolvedValue({ success: true, data: { shipping: { rate_id: 'rate-1', total: 5.5 } } })
    };
    const app = createApp({ onboardingShippingSelectService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/shipping')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.shipping.rate_id).toBe('rate-1');
    expect(onboardingShippingSelectService.selectShipping).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('requires bearer authentication', async () => {
    const onboardingShippingSelectService = { selectShipping: jest.fn() };
    const app = createApp({ onboardingShippingSelectService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/shipping').send({ rate_id: 'rate-1' });

    expect(response.status).toBe(401);
    expect(onboardingShippingSelectService.selectShipping).not.toHaveBeenCalled();
  });
});
