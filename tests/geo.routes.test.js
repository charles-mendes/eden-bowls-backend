const request = require('supertest');
const { createApp } = require('../src/app');
const { GeoService } = require('../src/services/geo.service');

describe('geo routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns the public geo context envelope', async () => {
    const geoService = {
      getContext: jest.fn().mockResolvedValue({
        success: true,
        data: {
          domain: 'com',
          country: 'US',
          ip: '8.8.8.8',
          region: null,
          source: 'backend',
          presetId: null
        }
      })
    };

    const app = createApp({ geoService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/geo/context')
      .set('Accept', 'application/json');

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toMatch(/no-store/);
    expect(response.body).toEqual({
      success: true,
      data: {
        domain: 'com',
        country: 'US',
        ip: '8.8.8.8',
        region: null,
        source: 'backend',
        presetId: null
      }
    });
    expect(geoService.getContext).toHaveBeenCalled();
  });

  test('returns 503 when the geo service is not injected', async () => {
    const app = createApp({ corsOrigins });
    const response = await request(app).get('/api/v1/geo/context');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      message: 'Geo service is not available.'
    });
  });

  test('stays public with a malformed Authorization header', async () => {
    const geoService = {
      getContext: jest.fn().mockResolvedValue({
        success: true,
        data: {
          domain: 'com',
          country: 'UNKNOWN',
          ip: '',
          region: null,
          source: 'backend',
          presetId: null
        }
      })
    };

    const app = createApp({ geoService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/geo/context')
      .set('Authorization', 'Token invalid');

    expect(response.status).toBe(200);
    expect(geoService.getContext).toHaveBeenCalled();
  });

  test('resolves domain from Origin through the real GeoService', async () => {
    const countryReader = {
      lookupIsoCode: jest.fn().mockResolvedValue('US')
    };
    const geoService = new GeoService({ countryReader, trustProxy: true });
    const app = createApp({ geoService, corsOrigins });

    const response = await request(app)
      .get('/api/v1/geo/context')
      .set('Origin', 'https://www.edenbowls.com.br')
      .set('CF-Connecting-IP', '8.8.8.8');

    expect(response.status).toBe(200);
    expect(response.body.data.domain).toBe('com.br');
    expect(response.body.data.country).toBe('US');
    expect(response.body.data.ip).toBe('8.8.8.8');
    expect(countryReader.lookupIsoCode).toHaveBeenCalledWith('8.8.8.8');
  });
});
