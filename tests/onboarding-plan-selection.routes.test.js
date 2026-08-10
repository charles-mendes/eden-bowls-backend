const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding plan selection routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('persists a plan selection for a valid session', async () => {
    const onboardingPlanSelectionService = {
      setPlanSelection: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          plan_selection: {
            subscription_term_months: 1,
            catalog_pricing: {
              source: 'custom_meal_plan_builder',
              country: 'US',
              currency: 'USD',
              line_items: [
                {
                  pet_id: 'pet-1',
                  flavor: 'chicken',
                  quantity: 2,
                  unit_price: 10,
                  line_total: 20
                }
              ],
              subtotal: 20,
              discounted_first_month_total: 20
            },
            flavors_by_pet: [
              { pet_id: 'pet-1', flavors: ['chicken'] }
            ],
            pets: [
              { pet_id: 'pet-1', pet_name: 'Milo', enabled: true }
            ],
            validated_with: {
              recommendation_version: 'v1',
              validated_at: '2026-08-09T00:00:00.000Z'
            },
            updated_at: '2026-08-09T00:00:00.000Z'
          }
        }
      })
    };

    const app = createApp({ onboardingPlanSelectionService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/plan-selection')
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
        plan_selection: {
          subscription_term_months: 1,
          catalog_pricing: {
            source: 'custom_meal_plan_builder',
            country: 'US',
            currency: 'USD',
            line_items: [
              {
                pet_id: 'pet-1',
                flavor: 'chicken',
                quantity: 2,
                unit_price: 10,
                line_total: 20
              }
            ],
            subtotal: 20,
            discounted_first_month_total: 20
          },
          flavors_by_pet: [
            { pet_id: 'pet-1', flavors: ['chicken'] }
          ],
          pets: [
            { pet_id: 'pet-1', pet_name: 'Milo', enabled: true }
          ],
          validated_with: {
            recommendation_version: 'v1',
            validated_at: '2026-08-09T00:00:00.000Z'
          },
          updated_at: '2026-08-09T00:00:00.000Z'
        }
      }
    });
    expect(onboardingPlanSelectionService.setPlanSelection).toHaveBeenCalledWith({
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
    const onboardingPlanSelectionService = {
      setPlanSelection: jest.fn()
    };

    const app = createApp({ onboardingPlanSelectionService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/plan-selection')
      .send({ subscription_term_months: 1, pets: [] });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPlanSelectionService.setPlanSelection).not.toHaveBeenCalled();
  });
});
