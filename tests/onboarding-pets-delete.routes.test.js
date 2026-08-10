const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding pets delete routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('soft deletes a pet for a valid session', async () => {
    const onboardingPetDeleteService = {
      deletePet: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session: { session_id: 'session-123', pets: [] },
          removed_pet: {
            id: 'pet-1',
            deleted_at: '2026-08-09T00:00:00.000Z',
            deleted_by_user_id: 1,
            deleted_reason: 'user_request'
          }
        }
      })
    };

    const app = createApp({ onboardingPetDeleteService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .delete('/api/v1/onboarding/session/session-123/pets/pet-1')
      .set('x-session-token', 'token-123');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session: { session_id: 'session-123', pets: [] },
        removed_pet: {
          id: 'pet-1',
          deleted_at: '2026-08-09T00:00:00.000Z',
          deleted_by_user_id: 1,
          deleted_reason: 'user_request'
        }
      }
    });
    expect(onboardingPetDeleteService.deletePet).toHaveBeenCalledWith({
      sessionId: 'session-123',
      petId: 'pet-1',
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingPetDeleteService = {
      deletePet: jest.fn()
    };

    const app = createApp({ onboardingPetDeleteService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .delete('/api/v1/onboarding/session/session-123/pets/pet-1');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingPetDeleteService.deletePet).not.toHaveBeenCalled();
  });
});
