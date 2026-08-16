const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');
const { OnboardingRecommendationService } = require('../src/services/onboarding-recommendation.service');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding recommendation routes', () => {
  test('returns a recommendation for the authenticated user', async () => {
    const onboardingRecommendationService = {
      getRecommendation: jest.fn().mockResolvedValue({
        success: true,
        data: {
          country: 'US',
          recommendations: [{ pet_id: 'pet-1', pet_name: 'Milo', energy_kcal_dia: 500, quantidade_g_dia: 300 }],
          simplified: { country: 'US', period_days: 30, labels: { daily: 'Per day', monthly: 'Per month', packs: 'Packs' }, pets: [] },
          version: 'v1'
        }
      })
    };
    const app = createApp({ onboardingRecommendationService, corsOrigins, jwt });

    const response = await request(app)
      .get('/api/v1/onboarding/recommendation')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.country).toBe('US');
    expect(onboardingRecommendationService.getRecommendation).toHaveBeenCalledWith({ userId: 7, market: MARKETS.US, pets: undefined });
  });

  test('returns a recommendation without bearer authentication', async () => {
    const onboardingRecommendationService = {
      getRecommendation: jest.fn().mockResolvedValue({
        success: true,
        data: { country: 'US', version: 'v1' }
      })
    };
    const app = createApp({ onboardingRecommendationService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/onboarding/recommendation');

    expect(response.status).toBe(200);
    expect(onboardingRecommendationService.getRecommendation).toHaveBeenCalledWith({ userId: null, market: MARKETS.US, pets: undefined });
  });

  test('returns Brazil labels when the chosen market is BR', async () => {
    const app = createApp({
      onboardingRecommendationService: new OnboardingRecommendationService(new OnboardingRecommendationRepository()),
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .get('/api/v1/onboarding/recommendation')
      .set('X-Eden-Domain', 'com.br');

    expect(response.status).toBe(200);
    expect(response.body.data.country).toBe('BR');
    expect(response.body.data.simplified.labels.monthly).toBe('Mensal');
    expect(response.body.data.simplified.pets).toEqual([]);
  });

  test('calculates recommendation pets from the posted draft list without JWT', async () => {
    const app = createApp({
      onboardingRecommendationService: new OnboardingRecommendationService(new OnboardingRecommendationRepository()),
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .post('/api/v1/onboarding/recommendation')
      .set('X-Eden-Country', 'BR')
      .send({
        country: 'BR',
        pets: [{
          pet_id: '30709249-0598-40b3-bb49-591e4fdd5b8b',
          name: 'luna',
          breed: 'Maltese',
          age_years: 2,
          age_months: 0,
          weight: 13,
          weight_unit: 'kg',
          size: 'small',
          activity_level: 'high',
          pet_condition: 'overweight',
          neutered: false
        }]
      });

    expect(response.status).toBe(200);
    expect(response.body.data.country).toBe('BR');
    expect(response.body.data.simplified.pets).toHaveLength(1);
    expect(response.body.data.simplified.pets[0]).toMatchObject({
      pet_id: '30709249-0598-40b3-bb49-591e4fdd5b8b',
      pet_name: 'luna'
    });
    expect(response.body.data.simplified.pets[0].daily.grams).toBeGreaterThan(0);
  });
});
