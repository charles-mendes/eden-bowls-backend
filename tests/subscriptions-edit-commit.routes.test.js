const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

describe('subscriptions edit commit routes', () => {
  const corsOrigins = ['http://localhost:5173'];
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  function issueAccessToken(userId) {
    return issueJwtToken(
      { data: { user: { id: userId } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
  }

  test('returns 401 when the user is not authenticated', async () => {
    const subscriptionsEditCommitService = { commit: jest.fn() };
    const app = createApp({ subscriptionsEditCommitService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/subscriptions/sub_123/edit/commit')
      .send({ expected_current_hash: 'abc' });

    expect(response.status).toBe(401);
    expect(response.body.details).toEqual({ code: 'unauthorized' });
    expect(subscriptionsEditCommitService.commit).not.toHaveBeenCalled();
  });

  test('commits an edit for an authenticated user', async () => {
    const subscriptionsEditCommitService = {
      commit: jest.fn().mockResolvedValue({
        success: true,
        data: {
          subscription_id: 'sub_123',
          pending_webhook_confirmation: true,
          term_change: false,
          proration: { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: 'USD' },
          payment_state: 'paid',
          stripe_client_secret: null,
          edit_payment_pending: false
        }
      })
    };
    const app = createApp({ subscriptionsEditCommitService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/subscriptions/sub_123/edit/commit')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({
        subscription_term_months: 1,
        expected_current_hash: 'sha256-abc',
        pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
      });

    expect(response.status).toBe(200);
    expect(response.body.data.subscription_id).toBe('sub_123');
    expect(subscriptionsEditCommitService.commit).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      payload: expect.objectContaining({ expected_current_hash: 'sha256-abc' }),
      userId: 7
    });
  });
});
