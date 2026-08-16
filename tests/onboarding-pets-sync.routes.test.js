const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');

describe('onboarding pets sync routes', () => {
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  function token(userId) {
    return issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });
  }

  test('syncs pets for the authenticated user', async () => {
    const onboardingPetsSyncService = {
      syncPets: jest.fn().mockResolvedValue({ success: true, data: { pets: [{ local_id: 'local-1', id: 'pet-1' }] } })
    };
    const app = createApp({ onboardingPetsSyncService, corsOrigins: ['http://localhost:5173'], jwt });
    const payload = { pets: [{ local_id: 'local-1', name: 'Luna', enabled: true }] };

    const response = await request(app)
      .post('/api/v1/onboarding/pets/sync')
      .set('Authorization', `Bearer ${token(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(onboardingPetsSyncService.syncPets).toHaveBeenCalledWith({
      userId: 7,
      payload: { pets: [{ local_id: 'local-1', name: 'Luna', weight_unit: 'lb' }] },
      market: MARKETS.US
    });
  });

  test('requires bearer authentication', async () => {
    const onboardingPetsSyncService = { syncPets: jest.fn() };
    const app = createApp({ onboardingPetsSyncService, corsOrigins: ['http://localhost:5173'], jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/pets/sync')
      .send({ pets: [] });

    expect(response.status).toBe(401);
    expect(onboardingPetsSyncService.syncPets).not.toHaveBeenCalled();
  });
});