const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');
const { OnboardingPlanSnapshotService } = require('../src/services/onboarding-plan-snapshot.service');
const { OnboardingPlanSnapshotRepository } = require('../src/infrastructure/repositories/onboarding-plan-snapshot.repository');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding plan snapshot routes', () => {
  test('returns a plan snapshot for the authenticated user', async () => {
    const onboardingPlanSnapshotService = {
      getSnapshot: jest.fn().mockResolvedValue({
        success: true,
        data: {
          country: 'US', currency: 'USD', labels: { daily: 'Per day', monthly: 'Per month', packs: 'Packs' },
          consumption: { labels: { daily: 'Per day', monthly: 'Per month', packs: 'Packs' }, pets: [] },
          pets: [], flavor_options: [{ key: 'chicken', label: 'Chicken' }], plan_terms: [{ subscription_term_months: 1, discount_percent: 10 }]
        }
      })
    };
    const app = createApp({ onboardingPlanSnapshotService, corsOrigins, jwt });

    const response = await request(app)
      .get('/api/v1/onboarding/plan/snapshot')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.currency).toBe('USD');
    expect(onboardingPlanSnapshotService.getSnapshot).toHaveBeenCalledWith({ userId: 7, market: MARKETS.US, pets: undefined });
  });

  test('returns a plan snapshot without bearer authentication', async () => {
    const onboardingPlanSnapshotService = {
      getSnapshot: jest.fn().mockResolvedValue({
        success: true,
        data: { country: 'US', currency: 'USD', flavor_options: [{ key: 'chicken', label: 'Chicken' }] }
      })
    };
    const app = createApp({ onboardingPlanSnapshotService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/onboarding/plan/snapshot');

    expect(response.status).toBe(200);
    expect(onboardingPlanSnapshotService.getSnapshot).toHaveBeenCalledWith({ userId: null, market: MARKETS.US, pets: undefined });
  });

  test('returns Brazil labels and currency when the chosen market is BR', async () => {
    const app = createApp({
      onboardingPlanSnapshotService: new OnboardingPlanSnapshotService(new OnboardingPlanSnapshotRepository()),
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .get('/api/v1/onboarding/plan/snapshot')
      .query({ country: 'BR' });

    expect(response.status).toBe(200);
    expect(response.body.data.country).toBe('BR');
    expect(response.body.data.currency).toBe('BRL');
    expect(response.body.data.labels.daily).toBe('Diário');
    expect(response.body.data.flavor_options).toEqual([
      { key: 'beef', label: 'Bovino' },
      { key: 'fish', label: 'Peixe' },
      { key: 'pork', label: 'Porco' },
      { key: 'turkey', label: 'Peru' }
    ]);
    expect(response.body.data.pets).toEqual([]);
    expect(response.body.data.consumption.pets).toEqual([]);
  });

  test('returns United States flavor options with USD labels', async () => {
    const app = createApp({
      onboardingPlanSnapshotService: new OnboardingPlanSnapshotService(new OnboardingPlanSnapshotRepository()),
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .get('/api/v1/onboarding/plan/snapshot')
      .query({ country: 'US' });

    expect(response.status).toBe(200);
    expect(response.body.data.country).toBe('US');
    expect(response.body.data.currency).toBe('USD');
    expect(response.body.data.flavor_options).toEqual([
      { key: 'beef', label: 'Beef' },
      { key: 'fish', label: 'Fish' },
      { key: 'pork', label: 'Pork' },
      { key: 'turkey', label: 'Turkey' }
    ]);
  });

  test('calculates snapshot consumption from the posted draft pets without JWT', async () => {
    const app = createApp({
      onboardingPlanSnapshotService: new OnboardingPlanSnapshotService(new OnboardingPlanSnapshotRepository({
        recommendationRepository: new OnboardingRecommendationRepository()
      })),
      corsOrigins,
      jwt
    });

    const response = await request(app)
      .post('/api/v1/onboarding/plan/snapshot')
      .send({
        country: 'BR',
        pets: [{
          pet_id: 'local-luna',
          name: 'luna',
          weight: 13,
          weight_unit: 'kg',
          activity_level: 'high',
          pet_condition: 'overweight',
          neutered: false
        }]
      });

    expect(response.status).toBe(200);
    expect(response.body.data.country).toBe('BR');
    expect(response.body.data.pets).toHaveLength(1);
    expect(response.body.data.pets[0]).toMatchObject({
      pet_id: 'local-luna',
      pet_name: 'luna'
    });
    expect(response.body.data.consumption.pets[0].daily.grams).toBeGreaterThan(0);
  });
});
