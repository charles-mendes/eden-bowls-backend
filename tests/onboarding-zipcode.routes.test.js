const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding zipcode routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('persists a valid zipcode payload for a valid session', async () => {
    const onboardingZipcodeService = {
      setZipcode: jest.fn().mockResolvedValue({
        success: true,
        data: {
          session_id: 'session-123',
          zipcode: {
            zipcode: '94105',
            postal_code: '94105',
            country: 'US',
            state: 'CA',
            city: 'San Francisco',
            street: 'Market St',
            number: '100',
            neighborhood: 'Downtown',
            complement: 'Suite 1',
            phone: '+1-555-0100',
            phone_country: 'US',
            delivery_instructions: 'Leave at front desk',
            address_line1: 'Market St',
            address_line2: 'Suite 1'
          }
        }
      })
    };

    const app = createApp({
      onboardingZipcodeService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/zipcode')
      .set('x-session-token', 'token-123')
      .send({
        zipcode: '94105',
        country: 'US',
        state: 'CA',
        city: 'San Francisco',
        street: 'Market St',
        number: '100',
        neighborhood: 'Downtown',
        complement: 'Suite 1',
        phone: '+1-555-0100',
        phone_country: 'US',
        delivery_instructions: 'Leave at front desk'
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        session_id: 'session-123',
        zipcode: {
          zipcode: '94105',
          postal_code: '94105',
          country: 'US',
          state: 'CA',
          city: 'San Francisco',
          street: 'Market St',
          number: '100',
          neighborhood: 'Downtown',
          complement: 'Suite 1',
          phone: '+1-555-0100',
          phone_country: 'US',
          delivery_instructions: 'Leave at front desk',
          address_line1: 'Market St',
          address_line2: 'Suite 1'
        }
      }
    });
    expect(onboardingZipcodeService.setZipcode).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        zipcode: '94105',
        country: 'US',
        state: 'CA',
        city: 'San Francisco',
        street: 'Market St',
        number: '100',
        neighborhood: 'Downtown',
        complement: 'Suite 1',
        phone: '+1-555-0100',
        phone_country: 'US',
        delivery_instructions: 'Leave at front desk'
      },
      currentUser: undefined,
      sessionToken: 'token-123'
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingZipcodeService = {
      setZipcode: jest.fn()
    };

    const app = createApp({
      onboardingZipcodeService,
      corsOrigins,
      jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' }
    });

    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/zipcode')
      .send({ zipcode: '94105', country: 'US', state: 'CA', city: 'San Francisco' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingZipcodeService.setZipcode).not.toHaveBeenCalled();
  });
});
