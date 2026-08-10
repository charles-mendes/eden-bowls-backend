const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding shipping select routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('persists a shipping selection for a valid session', async () => {
    const onboardingShippingSelectService = {
      selectShipping: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          shipping: {
            rate_id: 'rate-1',
            method_id: 'method-1',
            instance_id: 1,
            label: 'Express Delivery',
            cost: 5,
            tax_total: 0.5,
            total: 5.5,
            transit_business_days: 2,
            delivery_days: 2,
            delivery_days_min: 2,
            delivery_days_max: 2,
            estimate_label: '2 business days',
            selected_at: '2026-08-09T00:00:00.000Z',
            quoted_at: '2026-08-09T00:00:00.000Z',
            distance: 10,
            distance_source: 'google',
            per_km: 0.5,
            zipcode: '94105',
            snapshot: true
          },
          subtotal: 20,
          product_tax: 2,
          product_tax_percent: 10,
          tax_jurisdiction: 'US-CA'
        }
      })
    };

    const app = createApp({ onboardingShippingSelectService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/shipping/select')
      .set('x-session-token', 'token-123')
      .send({
        rate_id: 'rate-1',
        method_id: 'method-1',
        label: 'Express Delivery',
        cost: 5,
        tax_total: 0.5,
        total: 5.5,
        instance_id: 1,
        transit_business_days: 2,
        zipcode: '94105'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        shipping: {
          rate_id: 'rate-1',
          method_id: 'method-1',
          instance_id: 1,
          label: 'Express Delivery',
          cost: 5,
          tax_total: 0.5,
          total: 5.5,
          transit_business_days: 2,
          delivery_days: 2,
          delivery_days_min: 2,
          delivery_days_max: 2,
          estimate_label: '2 business days',
          selected_at: '2026-08-09T00:00:00.000Z',
          quoted_at: '2026-08-09T00:00:00.000Z',
          distance: 10,
          distance_source: 'google',
          per_km: 0.5,
          zipcode: '94105',
          snapshot: true
        },
        subtotal: 20,
        product_tax: 2,
        product_tax_percent: 10,
        tax_jurisdiction: 'US-CA'
      }
    });
    expect(onboardingShippingSelectService.selectShipping).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        rate_id: 'rate-1',
        method_id: 'method-1',
        label: 'Express Delivery',
        cost: 5,
        tax_total: 0.5,
        total: 5.5,
        instance_id: 1,
        transit_business_days: 2,
        zipcode: '94105'
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingShippingSelectService = {
      selectShipping: jest.fn()
    };

    const app = createApp({ onboardingShippingSelectService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/shipping/select')
      .send({ rate_id: 'rate-1' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingShippingSelectService.selectShipping).not.toHaveBeenCalled();
  });
});
