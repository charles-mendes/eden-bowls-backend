const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { MARKETS } = require('../src/core/market');

describe('onboarding pets routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  function issueAccessToken(userId) {
    return issueJwtToken(
      { data: { user: { id: userId } } },
      {
        secret: 'secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        ttlSeconds: 900,
        now: Math.floor(Date.now() / 1000)
      }
    );
  }

  test('lists pets for the authenticated user', async () => {
    const onboardingPetsService = {
      listPets: jest.fn().mockResolvedValue({
        success: true,
        data: {
          pets: [
            {
              id: 'pet-1',
              name: 'Milo',
              breed: 'Labrador',
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
          ]
        }
      })
    };

    const app = createApp({ onboardingPetsService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/pets')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        pets: [
          {
            id: 'pet-1',
            name: 'Milo',
            breed: 'Labrador',
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
        ]
      }
    });
    expect(onboardingPetsService.listPets).toHaveBeenCalledWith({
      userId: 7,
      market: MARKETS.US
    });
  });

  test('forwards the Brazil market when the country header is sent', async () => {
    const onboardingPetsService = {
      listPets: jest.fn().mockResolvedValue({ success: true, data: { country: 'BR', pets: [] } })
    };
    const app = createApp({ onboardingPetsService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });

    const response = await request(app)
      .get('/api/v1/onboarding/pets')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .set('X-Eden-Country', 'BR');

    expect(response.status).toBe(200);
    expect(onboardingPetsService.listPets).toHaveBeenCalledWith({
      userId: 7,
      market: MARKETS.BR
    });
  });

  test('returns 401 when bearer authentication is missing', async () => {
    const onboardingPetsService = {
      listPets: jest.fn()
    };

    const app = createApp({ onboardingPetsService, corsOrigins, jwt: { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' } });
    const response = await request(app)
      .get('/api/v1/onboarding/pets');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      message: 'Authentication is required.'
    });
    expect(onboardingPetsService.listPets).not.toHaveBeenCalled();
  });
});
