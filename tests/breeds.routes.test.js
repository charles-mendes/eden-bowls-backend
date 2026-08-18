const request = require('supertest');
const { createApp } = require('../src/app');

describe('breeds routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns the public breeds contract for the modern route', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: [
            {
              id: 1,
              name: 'Maltese',
              name_pt: 'Maltês',
              name_en: 'Maltese',
              size: 'small'
            }
          ]
        }
      })
    };

    const app = createApp({ breedsService, corsOrigins });
    const response = await request(app).get('/api/v1/breeds').query({ search: ' malt ', lang: 'en', limit: '12' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        items: [
          {
            id: 1,
            name: 'Maltese',
            name_pt: 'Maltês',
            name_en: 'Maltese',
            size: 'small'
          }
        ]
      }
    });
    expect(breedsService.listBreeds).toHaveBeenCalledWith({
      search: 'malt',
      lang: 'en',
      limit: 12
    });
  });

  test('keeps /api/v1 route defaults when optional params are omitted', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: []
        }
      })
    };

    const app = createApp({ breedsService, corsOrigins });
    const response = await request(app).get('/api/v1/breeds').query({ limit: 0 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        items: []
      }
    });
    expect(breedsService.listBreeds).toHaveBeenCalledWith({
      search: '',
      lang: 'pt',
      limit: 10
    });
  });

  test('returns an empty list when the breeds table is missing', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: []
        }
      })
    };

    const app = createApp({ breedsService, corsOrigins });
    const response = await request(app).get('/api/v1/breeds').query({ search: 'malt', lang: 'en', limit: '12' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        items: []
      }
    });
  });

  test('returns CORS headers for allowed origins', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: []
        }
      })
    };

    const app = createApp({ breedsService, corsOrigins });
    const response = await request(app)
      .get('/api/v1/breeds')
      .set('Origin', 'http://localhost:5173')
      .query({ search: 'malt', lang: 'pt', limit: '12' });

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  test('handles CORS preflight request for allowed origins', async () => {
    const breedsService = {
      listBreeds: jest.fn()
    };

    const app = createApp({ breedsService, corsOrigins });
    const response = await request(app)
      .options('/api/v1/breeds')
      .set('Origin', 'http://localhost:5173');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(breedsService.listBreeds).not.toHaveBeenCalled();
  });
});