const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

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
      .send({ name: 'Milo', ageYears: 3, weightUnit: 'kg' });

    expect(response.status).toBe(200);
    expect(response.body.data.pet.id).toBe('pet-1');
    expect(onboardingPetUpdateService.updatePet).toHaveBeenCalledWith({
      userId: 7,
      petId: 'pet-1',
      payload: { name: 'Milo', age_years: 3, weight_unit: 'kg' }
    });
  });

  test('does not call the service without bearer authentication', async () => {
    const onboardingPetUpdateService = { updatePet: jest.fn() };
    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt });

    const response = await request(app).patch('/api/v1/onboarding/pets/pet-1').send({ name: 'Milo' });

    expect(response.status).toBe(401);
    expect(onboardingPetUpdateService.updatePet).not.toHaveBeenCalled();
  });
});
