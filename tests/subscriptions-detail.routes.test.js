const request = require('supertest');
const { createApp } = require('../src/app');

describe('subscriptions detail routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns subscription detail for an authenticated user', async () => {
    const subscriptionsDetailService = {
      getDetail: jest.fn().mockResolvedValue({
        success: true,
        data: {
          subscription: {
            subscription_id: 'sub_123',
            stripe_subscription_id: 'sub_123',
            plan_label: 'Premium',
            status: 'active',
            pets_names: ['Milo'],
            billing_history: [],
            plan_items: [],
            stripe_timeline: []
          }
        }
      })
    };

    const app = createApp({
      subscriptionsDetailService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .get('/api/v1/subscriptions/sub_123/detail')
      .set('Authorization', 'Bearer token-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        subscription: {
          subscription_id: 'sub_123',
          stripe_subscription_id: 'sub_123',
          plan_label: 'Premium',
          status: 'active',
          pets_names: ['Milo'],
          billing_history: [],
          plan_items: [],
          stripe_timeline: []
        }
      }
    });
    expect(subscriptionsDetailService.getDetail).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      currentUser: undefined,
      sessionToken: ''
    });
  });

  test('returns 401 when the user is not authenticated', async () => {
    const subscriptionsDetailService = {
      getDetail: jest.fn()
    };

    const app = createApp({
      subscriptionsDetailService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .get('/api/v1/subscriptions/sub_123/detail');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.'
    });
    expect(subscriptionsDetailService.getDetail).not.toHaveBeenCalled();
  });
});
