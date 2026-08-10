const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding pets create routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('creates a pet for a valid session', async () => {
    const onboardingPetCreateService = {
      createPet: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session: { session_id: 'session-123', pets: [] },
          pet: {
            id: 'pet-1',
            name: 'Milo',
            breed: 'Labrador',
            type: 'dog',
            age_years: 2,
            age_months: 0,
            age: 2,
            weight_input: 10,
            weight_unit: 'kg',
            weight_kg: 10,
            weight: 10,
            size: 'large',
            activity_level: 'high',
            pet_condition: 'ideal',
            neutered: true,
            image_url: ''
          }
        }
      })
    };

    const app = createApp({ onboardingPetCreateService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/pets')
      .set('x-session-token', 'token-123')
      .send({
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
      });

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
          age_years: 2,
          age_months: 0,
          age: 2,
          weight_input: 10,
          weight_unit: 'kg',
          weight_kg: 10,
          weight: 10,
          size: 'large',
          activity_level: 'high',
          pet_condition: 'ideal',
          neutered: true,
          image_url: ''
        }
      }
    });
    expect(onboardingPetCreateService.createPet).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
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
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPetCreateService = {
      createPet: jest.fn()
    };

    const app = createApp({ onboardingPetCreateService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/pets')
      .send({
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
      });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPetCreateService.createPet).not.toHaveBeenCalled();
  });
});
