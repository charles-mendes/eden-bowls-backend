const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding zipcode lookup routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a found zipcode lookup result without onboarding session authentication', async () => {
    const onboardingZipcodeLookupService = {
      lookup: jest.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'found', country: 'US', zipcode_input: '94105', zipcode: '94105', is_complete: true,
          state: 'CA', city: 'San Francisco', street: 'Market St', neighborhood: 'Downtown', complement: '', message: 'Address found.'
        }
      })
    };
    const app = createApp({ onboardingZipcodeLookupService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });

    const response = await request(app)
      .post('/api/v1/onboarding/zipcode/lookup')
      .send({ zipcode: '94105', country: 'US' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('found');
    expect(onboardingZipcodeLookupService.lookup).toHaveBeenCalledWith({ payload: { zipcode: '94105', country: 'US' } });
  });

  test('returns functional incomplete result without authentication', async () => {
    const onboardingZipcodeLookupService = {
      lookup: jest.fn().mockResolvedValue({
        success: true,
        data: { status: 'incomplete', country: 'US', zipcode_input: '94', zipcode: '94', is_complete: false, state: '', city: '', street: '', neighborhood: '', complement: '' }
      })
    };
    const app = createApp({ onboardingZipcodeLookupService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });

    const response = await request(app).post('/api/v1/onboarding/zipcode/lookup').send({ zipcode: '94', country: 'US' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('incomplete');
  });
});
