const request = require('supertest');
const { createApp } = require('../src/app');

describe('subscriptions actions routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('executes a supported subscription action for an authenticated user', async () => {
    const subscriptionsActionsService = {
      executeAction: jest.fn().mockResolvedValue({
        success: true,
        data: {
          action: 'pause',
          pending_webhook_confirmation: true,
          command_result: [{ status: 'queued' }],
          subscription: {
            id: 'sub_123',
            status: 'active',
            plan_label: 'Premium'
          }
        }
      })
    };

    const app = createApp({
      subscriptionsActionsService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/sub_123/actions')
      .set('Authorization', 'Bearer token-123')
      .send({ action: 'pause' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        action: 'pause',
        pending_webhook_confirmation: true,
        command_result: [{ status: 'queued' }],
        subscription: {
          id: 'sub_123',
          status: 'active',
          plan_label: 'Premium'
        }
      }
    });
    expect(subscriptionsActionsService.executeAction).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      payload: { action: 'pause' },
      currentUser: undefined,
      sessionToken: ''
    });
  });

  test('returns 401 when the user is not authenticated', async () => {
    const subscriptionsActionsService = {
      executeAction: jest.fn()
    };

    const app = createApp({
      subscriptionsActionsService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/sub_123/actions')
      .send({ action: 'pause' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.'
    });
    expect(subscriptionsActionsService.executeAction).not.toHaveBeenCalled();
  });
});
