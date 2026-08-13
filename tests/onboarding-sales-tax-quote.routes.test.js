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

describe('onboarding sales tax quote routes', () => {
  test('returns a sales tax quote for the authenticated user', async () => {
    const payload = { address: { country: 'US', state: 'CA', postal_code: '94105' } };
    const onboardingSalesTaxQuoteService = {
      quote: jest.fn().mockResolvedValue({
        success: true,
        data: { subtotal: 20, product_tax: 2, product_tax_percent: 10, tax_jurisdiction: 'US-CA', country: 'US' }
      })
    };
    const app = createApp({ onboardingSalesTaxQuoteService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/sales-tax/quote')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.product_tax).toBe(2);
    expect(onboardingSalesTaxQuoteService.quote).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('requires bearer authentication', async () => {
    const onboardingSalesTaxQuoteService = { quote: jest.fn() };
    const app = createApp({ onboardingSalesTaxQuoteService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/sales-tax/quote').send({ address: { country: 'US', state: 'CA', postal_code: '94105' } });

    expect(response.status).toBe(401);
    expect(onboardingSalesTaxQuoteService.quote).not.toHaveBeenCalled();
  });
});
