const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding recommendation routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a recommendation for a valid session', async () => {
    const onboardingRecommendationService = {
      getRecommendation: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          country: 'US',
          recommendations: [
            {
              pet_id: 'pet-1',
              pet_name: 'Milo',
              energy_kcal_dia: 500,
              quantidade_g_dia: 300
            }
          ],
          packaging: {
            selected_frequency: 'monthly',
            period_days: 30,
            suggested_frequency: 'monthly',
            suggested_period_days: 30
          },
          simplified: {
            country: 'US',
            period_days: 30,
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
          version: 'v1'
        }
      })
    };

    const app = createApp({ onboardingRecommendationService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/session/session-123/recommendation')
      .set('x-session-token', 'token-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        country: 'US',
        recommendations: [
          {
            pet_id: 'pet-1',
            pet_name: 'Milo',
            energy_kcal_dia: 500,
            quantidade_g_dia: 300
          }
        ],
        packaging: {
          selected_frequency: 'monthly',
          period_days: 30,
          suggested_frequency: 'monthly',
          suggested_period_days: 30
        },
        simplified: {
          country: 'US',
          period_days: 30,
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
        version: 'v1'
      }
    });
    expect(onboardingRecommendationService.getRecommendation).toHaveBeenCalledWith({
      sessionId: 'session-123',
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingRecommendationService = {
      getRecommendation: jest.fn()
    };

    const app = createApp({ onboardingRecommendationService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/session/session-123/recommendation');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingRecommendationService.getRecommendation).not.toHaveBeenCalled();
  });
});
