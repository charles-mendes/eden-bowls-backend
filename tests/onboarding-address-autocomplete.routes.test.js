const request = require('supertest');
const { createApp } = require('../src/app');

describe('onboarding address autocomplete routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns autocomplete suggestions without onboarding session authentication', async () => {
    const onboardingAddressAutocompleteService = {
      autocomplete: jest.fn().mockResolvedValue({
        success: true,
        data: {
          status: 'found', country: 'US', query: '123 Main',
          suggestions: [{ id: '1', label: '123 Main St, Springfield, IL 62704', street: '123 Main St', city: 'Springfield', state: 'IL', zipcode: '62704', country: 'US', neighborhood: '', complement: '' }],
          message: 'Found 1 suggestion.'
        }
      })
    };
    const app = createApp({ onboardingAddressAutocompleteService, corsOrigins });
    const payload = { query: '123 Main', country: 'US', city: 'Springfield', state: 'IL' };

    const response = await request(app).post('/api/v1/onboarding/address/autocomplete').send(payload);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('found');
    expect(onboardingAddressAutocompleteService.autocomplete).toHaveBeenCalledWith({ payload });
  });

  test('returns a functional unsupported country response without authentication', async () => {
    const onboardingAddressAutocompleteService = {
      autocomplete: jest.fn().mockResolvedValue({
        success: true,
        data: { status: 'unsupported_country', country: 'BR', query: '123 Main', suggestions: [], message: 'Autocomplete is currently supported only for US addresses.' }
      })
    };
    const app = createApp({ onboardingAddressAutocompleteService, corsOrigins });

    const response = await request(app).post('/api/v1/onboarding/address/autocomplete').send({ query: '123 Main', country: 'BR' });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('unsupported_country');
  });
});
