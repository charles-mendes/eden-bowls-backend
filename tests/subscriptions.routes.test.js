const request = require('supertest');
const { createApp } = require('../src/app');

describe('subscriptions routes', () => {
  const corsOrigins = ['http://localhost:5173'];

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
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .get('/api/v1/subscriptions')
      .set('Authorization', 'Bearer token-123');

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
      currentUser: undefined,
      sessionToken: ''
    });
  });

  test('returns 401 when the user is not authenticated', async () => {
    const subscriptionsService = { listMine: jest.fn() };

    const app = createApp({
      subscriptionsService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .get('/api/v1/subscriptions');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.'
    });
    expect(subscriptionsService.listMine).not.toHaveBeenCalled();
  });
});
