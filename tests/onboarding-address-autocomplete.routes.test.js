const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding address autocomplete routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns a successful autocomplete payload for supported US requests', async () => {
    const onboardingAddressAutocompleteService = {
      autocomplete: jest.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'found',
          country: 'US',
          query: '123 Main',
          suggestions: [
            {
              id: '1',
              label: '123 Main St, Springfield, IL 62704',
              street: '123 Main St',
              city: 'Springfield',
              state: 'IL',
              zipcode: '62704',
              country: 'US',
              neighborhood: '',
              complement: ''
            }
          ],
          message: 'Found 1 suggestion.'
        }
      })
    };

    const app = createApp({ onboardingAddressAutocompleteService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/address/autocomplete')
      .set('x-session-token', 'token-123')
      .send({ query: '123 Main', country: 'US', city: 'Springfield', state: 'IL' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'found',
        country: 'US',
        query: '123 Main',
        suggestions: [
          {
            id: '1',
            label: '123 Main St, Springfield, IL 62704',
            street: '123 Main St',
            city: 'Springfield',
            state: 'IL',
            zipcode: '62704',
            country: 'US',
            neighborhood: '',
            complement: ''
          }
        ],
        message: 'Found 1 suggestion.'
      }
    });
    expect(onboardingAddressAutocompleteService.autocomplete).toHaveBeenCalledWith({
      sessionId: 'session-123',
      payload: {
        query: '123 Main',
        country: 'US',
        city: 'Springfield',
        state: 'IL'
      }
    });
  });

  test('returns 401 when the session token is missing', async () => {
    const onboardingAddressAutocompleteService = {
      autocomplete: jest.fn()
    };

    const app = createApp({ onboardingAddressAutocompleteService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/address/autocomplete')
      .send({ query: '123 Main', country: 'US' });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Session access token is required.'
    });
    expect(onboardingAddressAutocompleteService.autocomplete).not.toHaveBeenCalled();
  });

  test('returns a functional unsupported_country response for BR requests', async () => {
    const onboardingAddressAutocompleteService = {
      autocomplete: jest.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'unsupported_country',
          country: 'BR',
          query: '123 Main',
          suggestions: [],
          message: 'Autocomplete is currently supported only for US addresses.'
        }
      })
    };

    const app = createApp({ onboardingAddressAutocompleteService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/onboarding/session/session-123/address/autocomplete')
      .set('authorization', 'Bearer token-123')
      .send({ query: '123 Main', country: 'BR' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        status: 'unsupported_country',
        country: 'BR',
        query: '123 Main',
        suggestions: [],
        message: 'Autocomplete is currently supported only for US addresses.'
      }
    });
  });
});
