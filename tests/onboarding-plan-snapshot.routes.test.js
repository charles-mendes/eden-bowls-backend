const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding plan snapshot routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a plan snapshot for a valid session', async () => {
    const onboardingPlanSnapshotService = {
      getSnapshot: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          country: 'US',
          currency: 'USD',
          labels: {
            daily: 'Per day',
            monthly: 'Per month',
            packs: 'Packs'
          },
          consumption: {
            labels: {
              daily: 'Per day',
              monthly: 'Per month',
              packs: 'Packs'
            },
            pets: [
              {
                pet_id: 'pet-1',
                pet_name: 'Milo',
                daily: { value: 200, unit: 'g', grams: 200, formatted: '200 g' },
                monthly: { value: 6000, unit: 'g', grams: 6000, formatted: '6,000 g' },
                packs: { count: 2, pack_size_grams: 500, pack_size_value: 2, pack_size_unit: 'pack', formatted: '2 packs' }
              }
            ]
          },
          pets: [
            {
              pet_id: 'pet-1',
              pet_name: 'Milo',
              daily: { value: 200, unit: 'g', grams: 200, formatted: '200 g' },
              monthly: { value: 6000, unit: 'g', grams: 6000, formatted: '6,000 g' },
              packs: { count: 2, pack_size_grams: 500, pack_size_value: 2, pack_size_unit: 'pack', formatted: '2 packs' }
            }
          ],
          flavor_options: [
            { key: 'chicken', label: 'Chicken' }
          ],
          plan_terms: [
            { subscription_term_months: 1, discount_percent: 10 },
            { subscription_term_months: 3, discount_percent: 25 },
            { subscription_term_months: 6, discount_percent: 40 }
          ]
        }
      })
    };

    const app = createApp({ onboardingPlanSnapshotService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/session/session-123/plan/snapshot')
      .set('x-session-token', 'token-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        country: 'US',
        currency: 'USD',
        labels: {
          daily: 'Per day',
          monthly: 'Per month',
          packs: 'Packs'
        },
        consumption: {
          labels: {
            daily: 'Per day',
            monthly: 'Per month',
            packs: 'Packs'
          },
          pets: [
            {
              pet_id: 'pet-1',
              pet_name: 'Milo',
              daily: { value: 200, unit: 'g', grams: 200, formatted: '200 g' },
              monthly: { value: 6000, unit: 'g', grams: 6000, formatted: '6,000 g' },
              packs: { count: 2, pack_size_grams: 500, pack_size_value: 2, pack_size_unit: 'pack', formatted: '2 packs' }
            }
          ]
        },
        pets: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            daily: { value: 200, unit: 'g', grams: 200, formatted: '200 g' },
            monthly: { value: 6000, unit: 'g', grams: 6000, formatted: '6,000 g' },
            packs: { count: 2, pack_size_grams: 500, pack_size_value: 2, pack_size_unit: 'pack', formatted: '2 packs' }
          }
        ],
        flavor_options: [
          { key: 'chicken', label: 'Chicken' }
        ],
        plan_terms: [
          { subscription_term_months: 1, discount_percent: 10 },
          { subscription_term_months: 3, discount_percent: 25 },
          { subscription_term_months: 6, discount_percent: 40 }
        ]
      }
    });
    expect(onboardingPlanSnapshotService.getSnapshot).toHaveBeenCalledWith({
      sessionId: 'session-123',
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPlanSnapshotService = {
      getSnapshot: jest.fn()
    };

    const app = createApp({ onboardingPlanSnapshotService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/session/session-123/plan/snapshot');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPlanSnapshotService.getSnapshot).not.toHaveBeenCalled();
  });
});
