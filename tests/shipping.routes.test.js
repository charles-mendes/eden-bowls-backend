const request = require('supertest');
const { createApp } = require('../src/app');
const { ShippingService } = require('../src/services/shipping.service');
const { HttpError } = require('../src/core/http-error');

const corsOrigins = ['http://localhost:5173'];

describe('shipping v1 routes', () => {
  test('calculates BR shipping without authentication', async () => {
    const shippingService = {
      calculate: jest.fn().mockResolvedValue({
        success: true,
        data: {
          distance: 18.5,
          shipping: 17.58,
          delivery_days: 2,
          currency: 'BRL',
          distance_source: 'osrm'
        }
      })
    };
    const app = createApp({ shippingService, corsOrigins });

    const response = await request(app)
      .post('/shipping/v1/calculate')
      .send({ zipCode: '80010-000', country: 'BR' });

    expect(response.status).toBe(200);
    expect(response.body.data.shipping).toBe(17.58);
    expect(shippingService.calculate).toHaveBeenCalledWith({ zipCode: '80010-000', country: 'BR' });
  });

  test('rejects US calculate with 400 country_not_supported', async () => {
    const shippingService = {
      calculate: jest.fn().mockRejectedValue(
        new HttpError(400, 'Distance shipping is only available for Brazil.', { code: 'country_not_supported' })
      )
    };
    const app = createApp({ shippingService, corsOrigins });

    const response = await request(app)
      .post('/shipping/v1/calculate')
      .send({ zipCode: '94105', country: 'US' });

    expect(response.status).toBe(400);
    expect(response.body.details.code).toBe('country_not_supported');
  });

  test('returns US settings without authentication', async () => {
    const shippingService = {
      getPublicSettings: jest.fn().mockReturnValue({
        success: true,
        data: {
          country: 'US',
          enabled: true,
          cost: 12.9,
          label: 'FedEx 3–5 business days',
          carrier: 'FedEx',
          delivery: '3–5 business days',
          currency: 'USD'
        }
      })
    };
    const app = createApp({ shippingService, corsOrigins });

    const response = await request(app).get('/shipping/v1/settings').query({ country: 'US' });

    expect(response.status).toBe(200);
    expect(response.body.data.cost).toBe(12.9);
    expect(shippingService.getPublicSettings).toHaveBeenCalledWith('US');
  });
});

describe('ShippingService', () => {
  const settings = {
    br: {
      enabled: true,
      label: 'Entrega Eden Bowl',
      center: { name: 'CD', lat: -25.4284, lng: -49.2733, version: '1' },
      rule: {
        per_km: 0.95,
        road_factor: 1.3,
        min_fee: 0,
        max_fee: null,
        max_distance_km: 500,
        km_per_day: 80,
        min_days: 2,
        max_days: 10
      }
    },
    us: {
      enabled: true,
      cost: 12.9,
      label: 'FedEx 3–5 business days',
      carrier: 'FedEx',
      delivery: '3–5 business days'
    }
  };

  test('returns 400 for non-BR calculate', async () => {
    const service = new ShippingService({ settings });
    await expect(service.calculate({ zipCode: '94105', country: 'US' })).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'country_not_supported' }
    });
  });

  test('returns 422 when distance is out of coverage', async () => {
    const service = new ShippingService({
      settings,
      viaCepClient: {
        lookup: jest.fn().mockResolvedValue({
          status: 'ok',
          address: { city: 'Curitiba', state: 'PR', street: 'Rua', neighborhood: 'Centro', zipcode: '80010000' }
        })
      },
      nominatimClient: {
        geocodeBr: jest.fn().mockResolvedValue({ status: 'ok', lat: -20, lng: -40 })
      },
      osrmClient: {
        routeDriving: jest.fn().mockResolvedValue({ status: 'ok', distanceM: 612400, source: 'osrm' })
      }
    });

    await expect(service.calculate({ zipCode: '80010-000', country: 'BR' })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'out_of_coverage', distance: 612.4 }
    });
  });
});
