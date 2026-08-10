const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding pets update routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('updates a pet for a valid session', async () => {
    const onboardingPetUpdateService = {
      updatePet: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session: { session_id: 'session-123', pets: [] },
          pet: {
            id: 'pet-1',
            name: 'Milo',
            breed: 'Labrador',
            type: 'dog',
            age_years: 3,
            age_months: 0,
            age: 3,
            weight_input: 12,
            weight_unit: 'kg',
            weight_kg: 12,
            weight: 12,
            size: 'large',
            activity_level: 'high',
            pet_condition: 'ideal',
            neutered: true,
            image_url: ''
          }
        }
      })
    };

    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .patch('/api/v1/onboarding/session/session-123/pets/pet-1')
      .set('x-session-token', 'token-123')
      .send({ name: 'Milo', breed: 'Labrador', ageYears: 3, weightUnit: 'kg' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session: { session_id: 'session-123', pets: [] },
        pet: {
          id: 'pet-1',
          name: 'Milo',
          breed: 'Labrador',
          type: 'dog',
          age_years: 3,
          age_months: 0,
          age: 3,
          weight_input: 12,
          weight_unit: 'kg',
          weight_kg: 12,
          weight: 12,
          size: 'large',
          activity_level: 'high',
          pet_condition: 'ideal',
          neutered: true,
          image_url: ''
        }
      }
    });
    expect(onboardingPetUpdateService.updatePet).toHaveBeenCalledWith({
      sessionId: 'session-123',
      petId: 'pet-1',
      payload: {
        name: 'Milo',
        breed: 'Labrador',
        age_years: 3,
        weight_unit: 'kg'
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPetUpdateService = {
      updatePet: jest.fn()
    };

    const app = createApp({ onboardingPetUpdateService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .patch('/api/v1/onboarding/session/session-123/pets/pet-1')
      .send({ name: 'Milo' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPetUpdateService.updatePet).not.toHaveBeenCalled();
  });
});
