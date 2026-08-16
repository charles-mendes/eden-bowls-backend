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
    expect(onboardingRecommendationService.getRecommendation).toHaveBeenCalledWith({ userId: 7, market: MARKETS.US });
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
    expect(onboardingRecommendationService.getRecommendation).toHaveBeenCalledWith({ userId: null, market: MARKETS.US });
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
});
