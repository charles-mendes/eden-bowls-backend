const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

describe('onboarding pets update routes', () => {
  test('updates a pet owned by the authenticated user', async () => {
    const onboardingPetUpdateService = {
      updatePet: jest.fn().mockResolvedValue({
        success: true,
        data: { pet: { id: 'pet-1', name: 'Milo', age_years: 3, weight_unit: 'kg' } }
      })
    };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt });

    const response = await request(app)
      .patch('/api/v1/onboarding/pets/pet-1')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ name: 'Milo', ageYears: 3, weightUnit: 'kg', change_source: 'dashboard' });

    expect(response.status).toBe(200);
    expect(response.body.data.pet.id).toBe('pet-1');
    expect(onboardingPetUpdateService.updatePet).toHaveBeenCalledWith({
      userId: 7,
      petId: 'pet-1',
      payload: { name: 'Milo', age_years: 3, weight_unit: 'kg', change_source: 'dashboard' },
      market: MARKETS.US
    });
  });

  test('does not call the service without bearer authentication', async () => {
    const onboardingPetUpdateService = { updatePet: jest.fn() };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt });

    const response = await request(app).patch('/api/v1/onboarding/pets/pet-1').send({ name: 'Milo' });

    expect(response.status).toBe(401);
    expect(onboardingPetUpdateService.updatePet).not.toHaveBeenCalled();
  });

  test('ignores image_url on the generic pet PATCH body', async () => {
    const onboardingPetUpdateService = {
      updatePet: jest.fn().mockResolvedValue({
        success: true,
        data: { pet: { id: 'pet-1', name: 'Milo' } }
      })
    };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt });

    const response = await request(app)
      .patch('/api/v1/onboarding/pets/pet-1')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ name: 'Milo', image_url: 'https://evil.example/photo.jpg', change_source: 'onboarding' });

    expect(response.status).toBe(200);
    expect(onboardingPetUpdateService.updatePet).toHaveBeenCalledWith({
      userId: 7,
      petId: 'pet-1',
      payload: { name: 'Milo', change_source: 'onboarding' },
      market: MARKETS.US
    });
  });

  test('accepts an edit without change_source from the previous storefront, as onboarding, and logs a warning', async () => {
    const onboardingPetUpdateService = {
      updatePet: jest.fn().mockResolvedValue({ success: true, data: { pet: { id: 'pet-1', age_years: 8 } } })
    };
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt, logger });

    const response = await request(app)
      .patch('/api/v1/onboarding/pets/pet-1')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ age_years: 8 });

    expect(response.status).toBe(200);
    expect(onboardingPetUpdateService.updatePet).toHaveBeenCalledWith({
      userId: 7,
      petId: 'pet-1',
      payload: { age_years: 8, change_source: 'onboarding' },
      market: MARKETS.US
    });
    expect(logger.warn).toHaveBeenCalledWith({ userId: 7, petId: 'pet-1' }, 'Pet edit without change_source, recorded as onboarding.');
  });

  test('logs no warning when the storefront sends change_source', async () => {
    const onboardingPetUpdateService = {
      updatePet: jest.fn().mockResolvedValue({ success: true, data: { pet: { id: 'pet-1' } } })
    };
    const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt, logger });

    await request(app)
      .patch('/api/v1/onboarding/pets/pet-1')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ age_years: 8, change_source: 'dashboard' });

    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('refuses an unknown change_source', async () => {
    const onboardingPetUpdateService = { updatePet: jest.fn() };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt });

    const response = await request(app)
      .patch('/api/v1/onboarding/pets/pet-1')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ age_years: 8, change_source: 'admin' });

    expect(response.status).toBe(400);
    expect(onboardingPetUpdateService.updatePet).not.toHaveBeenCalled();
  });
});
