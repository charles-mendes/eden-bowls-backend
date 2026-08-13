const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

describe('subscriptions edit preview routes', () => {
  const corsOrigins = ['http://localhost:5173'];
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  function issueAccessToken(userId) {
    return issueJwtToken(
      { data: { user: { id: userId } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
  }

  test('returns edit preview for an authenticated user', async () => {
    const subscriptionsEditPreviewService = {
      preview: jest.fn().mockResolvedValue({
        success: true,
        data: {
          subscription_id: 'sub_123',
          expected_current_hash: 'hash-123',
          term_change: false,
          current: { subscription_term_months: 1, items: [], address: {} },
          proposed: { subscription_term_months: 1, items: [], address: {} },
          proration: { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: 'USD' },
          next_cycle: { subtotal: 30, tax: 0, total: 30, currency: 'USD' },
          discount: { eligible: false, reason: 'edit_no_first_purchase_promo', percent: 0 }
        }
      })
    };

    const app = createApp({
      subscriptionsEditPreviewService,
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/sub_123/edit/preview')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({
        subscription_term_months: 1,
        pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        subscription_id: 'sub_123',
        expected_current_hash: 'hash-123',
        term_change: false,
        current: { subscription_term_months: 1, items: [], address: {} },
        proposed: { subscription_term_months: 1, items: [], address: {} },
        proration: { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: 'USD' },
        next_cycle: { subtotal: 30, tax: 0, total: 30, currency: 'USD' },
        discount: { eligible: false, reason: 'edit_no_first_purchase_promo', percent: 0 }
      }
    });
    expect(subscriptionsEditPreviewService.preview).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      payload: {
        subscription_term_months: 1,
        pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
      },
      userId: 7
    });
  });

  test('returns 401 when the user is not authenticated', async () => {
    const subscriptionsEditPreviewService = { preview: jest.fn() };

    const app = createApp({
      subscriptionsEditPreviewService,
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .post('/api/v1/subscriptions/sub_123/edit/preview')
      .send({ subscription_term_months: 1, pets: [] });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.',
      details: { code: 'unauthorized' }
    });
    expect(subscriptionsEditPreviewService.preview).not.toHaveBeenCalled();
  });
});
