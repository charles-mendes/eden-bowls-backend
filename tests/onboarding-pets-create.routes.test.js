const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

describe('onboarding pets create routes', () => {
  const corsOrigins = ['http://localhost:5173'];
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  function issueAccessToken(userId) {
    return issueJwtToken(
      { data: { user: { id: userId } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
  }

  test('creates a pet for the authenticated user', async () => {
    const onboardingPetCreateService = {
      createPet: jest.fn().mockResolvedValue({
        success: true,
        data: {
          pet: {
            id: 'pet-1',
            name: 'Milo',
            breed: 'Labrador',
            age_years: 2,
            age_months: 0,
            weight_input: 10,
            weight_unit: 'kg',
            size: 'large',
            activity_level: 'high',
            pet_condition: 'ideal',
            neutered: true,
            image_url: ''
          }
        }
      })
    };
    const app = createApp({ onboardingPetCreateService, corsOrigins, jwt });
    const payload = {
      name: 'Milo',
      breed: 'Labrador',
      age_years: 2,
      age_months: 0,
      weight: 10,
      weight_unit: 'kg',
      size: 'large',
      activity_level: 'high',
      pet_condition: 'ideal',
      neutered: true
    };

    const response = await request(app)
      .post('/api/v1/onboarding/pets')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.pet.id).toBe('pet-1');
    expect(response.body.data.session).toBeUndefined();
    expect(onboardingPetCreateService.createPet).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('returns 401 without bearer authentication', async () => {
    const onboardingPetCreateService = { createPet: jest.fn() };
    const app = createApp({ onboardingPetCreateService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/pets').send({ name: 'Milo' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Authentication is required.');
    expect(onboardingPetCreateService.createPet).not.toHaveBeenCalled();
  });
});
