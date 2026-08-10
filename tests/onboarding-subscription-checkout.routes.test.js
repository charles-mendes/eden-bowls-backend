const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding subscription checkout routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('creates a subscription checkout for a valid session', async () => {
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          order_id: 101,
          order_key: 'order-key',
          status: 'pending',
          total: 29.99,
          subtotal: 25,
          product_tax: 2.5,
          shipping_total: 2.49,
          shipping_tax: 0.25,
          shipping_total_with_tax: 2.74,
          currency: 'USD',
          subscription_ids: [1],
          flexible_subscription_id: 7,
          stripe_subscription_id: 'sub_123',
          payment_state: 'requires_payment_method',
          has_payment_method: false,
          reused: false
        }
      })
    };

    const app = createApp({
      onboardingSubscriptionCheckoutService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/subscription/checkout')
      .set('x-session-token', 'token-123')
      .send({
        billing: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com'
        },
        paymentMethodId: 'pm_123',
        checkout_mode: 'subscription_first'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        order_id: 101,
        order_key: 'order-key',
        status: 'pending',
        total: 29.99,
        subtotal: 25,
        product_tax: 2.5,
        shipping_total: 2.49,
        shipping_tax: 0.25,
        shipping_total_with_tax: 2.74,
        currency: 'USD',
        subscription_ids: [1],
        flexible_subscription_id: 7,
        stripe_subscription_id: 'sub_123',
        payment_state: 'requires_payment_method',
        has_payment_method: false,
        reused: false
      }
    });
    expect(onboardingSubscriptionCheckoutService.checkout).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        billing: {
          first_name: 'Jane',
          last_name: 'Doe',
          email: 'jane@example.com'
        },
        paymentMethodId: 'pm_123',
        checkout_mode: 'subscription_first'
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingSubscriptionCheckoutService = {
      checkout: jest.fn()
    };

    const app = createApp({
      onboardingSubscriptionCheckoutService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/subscription/checkout')
      .send({ paymentMethodId: 'pm_123' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingSubscriptionCheckoutService.checkout).not.toHaveBeenCalled();
  });
});
