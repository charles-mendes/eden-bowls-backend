const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding zipcode lookup routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a found zipcode lookup result for a valid session', async () => {
    const onboardingZipcodeLookupService = {
      lookup: jest.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'found',
          country: 'US',
          zipcode_input: '94105',
          zipcode: '94105',
          is_complete: true,
          state: 'CA',
          city: 'San Francisco',
          street: 'Market St',
          neighborhood: 'Downtown',
          complement: '',
          message: 'Address found.'
        }
      })
    };

    const app = createApp({
      onboardingZipcodeLookupService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/zipcode/lookup')
      .set('x-session-token', 'token-123')
      .send({ zipcode: '94105', country: 'US' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'found',
        country: 'US',
        zipcode_input: '94105',
        zipcode: '94105',
        is_complete: true,
        state: 'CA',
        city: 'San Francisco',
        street: 'Market St',
        neighborhood: 'Downtown',
        complement: '',
        message: 'Address found.'
      }
    });
    expect(onboardingZipcodeLookupService.lookup).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: { zipcode: '94105', country: 'US' },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingZipcodeLookupService = {
      lookup: jest.fn()
    };

    const app = createApp({
      onboardingZipcodeLookupService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/zipcode/lookup')
      .send({ zipcode: '94105' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingZipcodeLookupService.lookup).not.toHaveBeenCalled();
  });
});
