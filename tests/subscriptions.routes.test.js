const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

describe('subscriptions routes', () => {
  const corsOrigins = ['http://localhost:5173'];
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  function issueAccessToken(userId) {
    return issueJwtToken(
      { data: { user: { id: userId } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
  }

  test('returns the current user subscriptions', async () => {
    const subscriptionsService = {
      listMine: jest.fn().mockResolvedValue({
        success: true,
        data: {
          subscriptions: [
            {
              subscription_id: 'sub_123',
              stripe_subscription_id: 'sub_123',
              plan_label: 'Premium',
              status: 'active',
              pets_names: ['Milo']
            }
          ],
          count: 1
        }
      })
    };

    const app = createApp({
      subscriptionsService,
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .get('/api/v1/subscriptions')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        subscriptions: [
          {
            subscription_id: 'sub_123',
            stripe_subscription_id: 'sub_123',
            plan_label: 'Premium',
            status: 'active',
            pets_names: ['Milo']
          }
        ],
        count: 1
      }
    });
    expect(subscriptionsService.listMine).toHaveBeenCalledWith({
      userId: 7
    });
  });

  test('returns 401 when the user is not authenticated', async () => {
    const subscriptionsService = { listMine: jest.fn() };

    const app = createApp({
      subscriptionsService,
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .get('/api/v1/subscriptions');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.',
      details: { code: 'unauthorized' }
    });
    expect(subscriptionsService.listMine).not.toHaveBeenCalled();
  });
});
