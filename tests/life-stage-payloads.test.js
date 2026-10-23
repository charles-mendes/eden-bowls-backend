const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');
const { buildSizeClassSeedRows } = require('../src/core/life-stage-seed');
const { LifeStageService } = require('../src/services/life-stage.service');
const { OnboardingRecommendationService } = require('../src/services/onboarding-recommendation.service');
const { OnboardingRecommendationRepository } = require('../src/infrastructure/repositories/onboarding-recommendation.repository');
const { OnboardingPlanSnapshotService } = require('../src/services/onboarding-plan-snapshot.service');
const { OnboardingPlanSnapshotRepository } = require('../src/infrastructure/repositories/onboarding-plan-snapshot.repository');
const { OnboardingPlanPreviewRepository } = require('../src/infrastructure/repositories/onboarding-plan-preview.repository');
const { OnboardingPetsService } = require('../src/services/onboarding-pets.service');
const { SubscriptionsService } = require('../src/services/subscriptions.service');
const { SubscriptionsDetailService } = require('../src/services/subscriptions-detail.service');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const STAGE_FIELDS = ['life_stage', 'life_stage_next_at', 'size_class', 'current_age_years', 'current_age_months'];

function token(userId = 7) {
  return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
}

function lifeStageService() {
  const limitsByMarket = {};
  for (const row of buildSizeClassSeedRows()) {
    limitsByMarket[row.market] = limitsByMarket[row.market] || {};
    limitsByMarket[row.market][row.sizeClass] = { adultFromMonths: row.adultFromMonths, seniorFromMonths: row.seniorFromMonths };
  }
  return new LifeStageService({
    repository: { forMarket: async (market) => ({ limits: limitsByMarket[market] || {}, breedClasses: new Map() }) },
    now: () => new Date('2026-10-18T12:00:00Z')
  });
}

// Luna is a 5-month-old medium puppy; Thor a 9-year-old medium senior registered on the same day.
const accountPets = [
  { id: 'pet-luna', name: 'Luna', breed: '', size: 'medium', age_years: 0, age_months: 5, weight_input: 8, weight_unit: 'kg', age_recorded_at: '2026-10-18T09:00:00.000Z', birth_date: null },
  { id: 'pet-thor', name: 'Thor', breed: '', size: 'medium', age_years: 9, age_months: 0, weight_input: 20, weight_unit: 'kg', age_recorded_at: '2026-10-18T09:00:00.000Z', birth_date: null }
];
const petsRepository = { listPets: jest.fn(async () => ({ pets: accountPets })) };

describe('life stage on every pet payload', () => {
  test('pet list carries the stage and current age', async () => {
    const onboardingPetsService = new OnboardingPetsService(petsRepository, { lifeStageService: lifeStageService() });
    const app = createApp({ onboardingPetsService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/onboarding/pets').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    const [luna, thor] = response.body.data.pets;
    expect(luna).toMatchObject({ life_stage: 'puppy', life_stage_next_at: '2027-05-18', size_class: 'medium', current_age_years: 0, current_age_months: 5 });
    expect(thor).toMatchObject({ life_stage: 'senior', life_stage_next_at: null, current_age_years: 9 });
  });

  test('an anonymous recommendation gives a stage to each draft pet', async () => {
    const onboardingRecommendationService = new OnboardingRecommendationService(
      new OnboardingRecommendationRepository(null, { lifeStageService: lifeStageService() })
    );
    const app = createApp({ onboardingRecommendationService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/recommendation')
      .send({ country: 'BR', pets: [{ pet_id: 'draft-1', name: 'Mel', size: 'small', age_months: 9, weight: 4, activity_level: 'medium' }] });

    expect(response.status).toBe(200);
    expect(response.body.data.simplified.pets[0]).toMatchObject({ pet_id: 'draft-1', life_stage: 'puppy', size_class: 'small', current_age_months: 9 });
  });

  test('a draft pet that exists in the account ages from the account record', async () => {
    const repository = new OnboardingRecommendationRepository(petsRepository, { lifeStageService: lifeStageService() });
    const data = await repository.getRecommendation(7, MARKETS.BR, [
      { pet_id: 'pet-thor', name: 'Thor', size: 'medium', age_years: 2, weight: 20, activity_level: 'medium' }
    ]);
    expect(data.simplified.pets[0]).toMatchObject({ pet_id: 'pet-thor', life_stage: 'senior', current_age_years: 9 });
  });

  test('the plan snapshot carries the stage of each pet', async () => {
    const recommendationRepository = new OnboardingRecommendationRepository(petsRepository, { lifeStageService: lifeStageService() });
    const onboardingPlanSnapshotService = new OnboardingPlanSnapshotService(
      new OnboardingPlanSnapshotRepository({ recommendationRepository, allowCatalogFallback: true })
    );
    const app = createApp({ onboardingPlanSnapshotService, corsOrigins, jwt });

    const response = await request(app).get('/api/v1/onboarding/plan/snapshot?country=BR').set('Authorization', `Bearer ${token()}`);

    expect(response.status).toBe(200);
    const stages = response.body.data.pets.map((pet) => [pet.pet_id, pet.life_stage]);
    expect(stages).toEqual([['pet-luna', 'puppy'], ['pet-thor', 'senior']]);
  });

  test('the plan preview carries the stage of each selected pet', async () => {
    const recommendationRepository = new OnboardingRecommendationRepository(petsRepository, { lifeStageService: lifeStageService() });
    const repository = new OnboardingPlanPreviewRepository({ recommendationRepository, allowCatalogFallback: true });

    const preview = await repository.previewPlan(7, {
      subscription_term_months: 1,
      pets: [{ pet_id: 'pet-luna', pet_name: 'Luna', enabled: true, selected_flavors: ['beef'], flavor_weights: [4] }]
    }, MARKETS.BR);

    const pet = preview.pets[0];
    expect(Object.keys(pet)).toEqual(expect.arrayContaining(STAGE_FIELDS));
    expect(pet).toMatchObject({ pet_id: 'pet-luna', life_stage: 'puppy', current_age_months: 5 });
  });

  test('subscription list and detail carry the stage of their pets, per market', async () => {
    const subscriptionsService = new SubscriptionsService({
      listMine: jest.fn().mockResolvedValue({ subscriptions: [{ subscription_id: 'sub_1', stripe_account: 'br', pet_ids: ['pet-thor', 'pet-gone'] }], count: 1 })
    }, { lifeStageService: lifeStageService(), petsRepository });
    const subscriptionsDetailService = new SubscriptionsDetailService({
      getDetail: jest.fn().mockResolvedValue({ subscription: { subscription_id: 'sub_1', stripe_account: 'br', pets: [{ id: 'pet-luna', name: 'Luna' }] } })
    }, { lifeStageService: lifeStageService(), petsRepository });
    const app = createApp({ subscriptionsService, subscriptionsDetailService, corsOrigins, jwt });

    const list = await request(app).get('/api/v1/subscriptions').set('Authorization', `Bearer ${token()}`);
    const detail = await request(app).get('/api/v1/subscriptions/sub_1/detail').set('Authorization', `Bearer ${token()}`);

    expect(list.status).toBe(200);
    expect(list.body.data.subscriptions[0].pet_life_stages).toEqual([
      { pet_id: 'pet-thor', life_stage: 'senior', life_stage_next_at: null, size_class: 'medium', current_age_years: 9, current_age_months: 0 }
    ]);
    expect(detail.status).toBe(200);
    expect(detail.body.data.subscription.pets[0]).toMatchObject({ id: 'pet-luna', life_stage: 'puppy', life_stage_next_at: '2027-05-18' });
  });
});
