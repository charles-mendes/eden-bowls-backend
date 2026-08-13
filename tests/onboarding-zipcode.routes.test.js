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

describe('onboarding address routes', () => {
  test('persists a confirmed address for the authenticated user', async () => {
    const payload = { zipcode: '94105', country: 'US', state: 'CA', city: 'San Francisco', street: 'Market St', number: '100' };
    const onboardingZipcodeService = {
      setZipcode: jest.fn().mockResolvedValue({
        success: true,
        data: { zipcode: { ...payload, postal_code: '94105', address_line1: 'Market St', address_line2: '' } }
      })
    };
    const app = createApp({ onboardingZipcodeService, corsOrigins, jwt });

    const response = await request(app)
      .post('/api/v1/onboarding/address')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.session_id).toBeUndefined();
    expect(response.body.data.zipcode.country).toBe('US');
    expect(onboardingZipcodeService.setZipcode).toHaveBeenCalledWith({ userId: 7, payload });
  });

  test('requires bearer authentication', async () => {
    const onboardingZipcodeService = { setZipcode: jest.fn() };
    const app = createApp({ onboardingZipcodeService, corsOrigins, jwt });

    const response = await request(app).post('/api/v1/onboarding/address').send({ zipcode: '94105', country: 'US', state: 'CA', city: 'San Francisco' });

    expect(response.status).toBe(401);
    expect(onboardingZipcodeService.setZipcode).not.toHaveBeenCalled();
  });
});
