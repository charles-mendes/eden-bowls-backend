const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding plan preview routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a plan preview for a valid session', async () => {
    const onboardingPlanPreviewService = {
      previewPlan: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          subscription_term_months: 1,
          currency: 'USD',
          totals: {
            grand_total: 20,
            grand_total_monthly: 20,
            first_month_total: 20
          },
          pricing: {
            grand_total: 20,
            grand_total_monthly: 20,
            first_month_total: 20
          },
          grand_total: 20,
          grand_total_monthly: 20,
          first_month_total: 20,
          pets: [
            {
              pet_id: 'pet-1',
              pet_name: 'Milo',
              monthly_total: 20,
              total: 20,
              first_month_total: 20
            }
          ],
          line_items: [
            {
              pet_id: 'pet-1',
              pet_name: 'Milo',
              flavor: 'chicken',
              quantity: 2,
              pack_size_grams: 500,
              pack_size_label: '500 g',
              variation_id: 100,
              product_id: 200,
              currency: 'USD',
              unit_price: 10,
              line_total: 20
            }
          ]
        }
      })
    };

    const app = createApp({ onboardingPlanPreviewService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/plan/preview')
      .set('x-session-token', 'token-123')
      .send({
        subscription_term_months: 1,
        pets: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            enabled: true,
            selected_flavors: ['chicken'],
            flavor_weights: [500]
          }
        ]
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        subscription_term_months: 1,
        currency: 'USD',
        totals: {
          grand_total: 20,
          grand_total_monthly: 20,
          first_month_total: 20
        },
        pricing: {
          grand_total: 20,
          grand_total_monthly: 20,
          first_month_total: 20
        },
        grand_total: 20,
        grand_total_monthly: 20,
        first_month_total: 20,
        pets: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            monthly_total: 20,
            total: 20,
            first_month_total: 20
          }
        ],
        line_items: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            flavor: 'chicken',
            quantity: 2,
            pack_size_grams: 500,
            pack_size_label: '500 g',
            variation_id: 100,
            product_id: 200,
            currency: 'USD',
            unit_price: 10,
            line_total: 20
          }
        ]
      }
    });
    expect(onboardingPlanPreviewService.previewPlan).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        subscription_term_months: 1,
        pets: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            enabled: true,
            selected_flavors: ['chicken'],
            flavor_weights: [500]
          }
        ]
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPlanPreviewService = {
      previewPlan: jest.fn()
    };

    const app = createApp({ onboardingPlanPreviewService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/plan/preview')
      .send({ subscription_term_months: 1, pets: [] });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPlanPreviewService.previewPlan).not.toHaveBeenCalled();
  });
});
