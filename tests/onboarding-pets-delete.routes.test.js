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

describe('onboarding pets delete routes', () => {
  test('soft deletes a pet owned by the authenticated user', async () => {
    const onboardingPetDeleteService = {
      deletePet: jest.fn().mockResolvedValue({
        success: true,
        data: {
          removed_pet: {
            id: 'pet-1',
            deleted_at: '2026-08-13T00:00:00.000Z',
            deleted_by_user_id: 7,
            deleted_reason: 'user_request'
          }
        }
      })
    };
    const app = createApp({ onboardingPetDeleteService, corsOrigins, jwt });

    const response = await request(app)
      .delete('/api/v1/onboarding/pets/pet-1')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.data.removed_pet.id).toBe('pet-1');
    expect(onboardingPetDeleteService.deletePet).toHaveBeenCalledWith({ userId: 7, petId: 'pet-1' });
  });

  test('does not call the service without bearer authentication', async () => {
    const onboardingPetDeleteService = { deletePet: jest.fn() };
    const app = createApp({ onboardingPetDeleteService, corsOrigins, jwt });

    const response = await request(app).delete('/api/v1/onboarding/pets/pet-1');

    expect(response.status).toBe(401);
    expect(onboardingPetDeleteService.deletePet).not.toHaveBeenCalled();
  });
});
