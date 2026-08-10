const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding sales tax quote routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a sales tax quote for a valid session', async () => {
    const onboardingSalesTaxQuoteService = {
      quote: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          subtotal: 20,
          product_tax: 2,
          product_tax_percent: 10,
          tax_jurisdiction: 'US-CA',
          country: 'US'
        }
      })
    };

    const app = createApp({ onboardingSalesTaxQuoteService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/sales-tax/quote')
      .set('x-session-token', 'token-123')
      .send({ address: { country: 'US', state: 'CA', postal_code: '94105' } });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        subtotal: 20,
        product_tax: 2,
        product_tax_percent: 10,
        tax_jurisdiction: 'US-CA',
        country: 'US'
      }
    });
    expect(onboardingSalesTaxQuoteService.quote).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: { address: { country: 'US', state: 'CA', postal_code: '94105' } },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingSalesTaxQuoteService = {
      quote: jest.fn()
    };

    const app = createApp({ onboardingSalesTaxQuoteService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/sales-tax/quote')
      .send({ address: { country: 'US', state: 'CA', postal_code: '94105' } });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingSalesTaxQuoteService.quote).not.toHaveBeenCalled();
  });
});
