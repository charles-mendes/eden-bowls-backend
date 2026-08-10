const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding payment intent ack routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns the ack payload for a valid request', async () => {
    const onboardingPaymentIntentAckService = {
      acknowledge: jest.fn().mockResolvedValue({
        success: true,
        data: {
          orderId: 42,
          stripePaymentIntentId: 'pi_123',
          stripePaymentIntentStatus: 'succeeded',
          paymentState: 'paid',
          acked: true
        }
      })
    };

    const app = createApp({ onboardingPaymentIntentAckService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/payment-intent/ack')
      .set('x-session-token', 'token-123')
      .send({ payment_intent_id: 'pi_123', payment_intent_status: 'succeeded' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        orderId: 42,
        stripePaymentIntentId: 'pi_123',
        stripePaymentIntentStatus: 'succeeded',
        paymentState: 'paid',
        acked: true
      }
    });
    expect(onboardingPaymentIntentAckService.acknowledge).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        paymentIntentId: 'pi_123',
        paymentIntentStatus: 'succeeded'
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPaymentIntentAckService = {
      acknowledge: jest.fn()
    };

    const app = createApp({ onboardingPaymentIntentAckService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/payment-intent/ack')
      .send({ payment_intent_id: 'pi_123', payment_intent_status: 'succeeded' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPaymentIntentAckService.acknowledge).not.toHaveBeenCalled();
  });
});
