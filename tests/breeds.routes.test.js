const request = require('supertest');
const { createApp } = require('../src/app');

describe('breeds routes', () => {
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

    const app = createApp({ breedsService });
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

  test('keeps the legacy WordPress-compatible path', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: []
        }
      })
    };

    const app = createApp({ breedsService });
    const response = await request(app).get('/wp-json/custom/v1/breeds').query({ limit: 0 });

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
});