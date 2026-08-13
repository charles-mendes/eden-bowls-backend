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

describe('onboarding payment intent ack routes', () => {
  test('acknowledges payment intent for the authenticated user', async () => {
    const onboardingPaymentIntentAckService = {
      acknowledge: jest.fn().mockResolvedValue({
        success: true,
        data: { orderId: 101, stripePaymentIntentId: 'pi_123', stripePaymentIntentStatus: 'succeeded', paymentState: 'paid', acked: true }
      })
    };
    const app = createApp({ onboardingPaymentIntentAckService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/payment-intent/ack')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ payment_intent_id: 'pi_123', payment_intent_status: 'succeeded' });

    expect(response.status).toBe(200);
    expect(response.body.data.acked).toBe(true);
    expect(onboardingPaymentIntentAckService.acknowledge).toHaveBeenCalledWith({
      userId: 7,
      payload: { paymentIntentId: 'pi_123', paymentIntentStatus: 'succeeded' }
    });
  });

  test('requires bearer authentication', async () => {
    const onboardingPaymentIntentAckService = { acknowledge: jest.fn() };
    const app = createApp({ onboardingPaymentIntentAckService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/payment-intent/ack')
      .send({ payment_intent_id: 'pi_123', payment_intent_status: 'succeeded' });

    expect(response.status).toBe(401);
    expect(onboardingPaymentIntentAckService.acknowledge).not.toHaveBeenCalled();
  });
});
