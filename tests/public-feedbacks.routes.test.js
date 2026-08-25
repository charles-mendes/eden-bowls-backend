const request = require('supertest');
const { createApp } = require('../src/app');

describe('public feedback routes', () => {
  test('returns only published feedbacks for a country', async () => {
    const feedbacksService = {
      listPublic: jest.fn().mockResolvedValue({
        success: true,
        data: {
          country: 'BR',
          items: [{
            id: 1,
            name: 'João Silva',
            category: 'tutor',
            country: 'BR',
            photo: '/feedback-photos/a.png',
            place: 'São Paulo',
            comment: 'Excelente.'
          }]
        }
      })
    };
    const app = createApp({ corsOrigins: ['http://localhost:5173'], feedbacksService });
    const response = await request(app).get('/api/v1/public/feedbacks?country=BR');

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].active).toBeUndefined();
    expect(feedbacksService.listPublic).toHaveBeenCalledWith({ country: 'BR' });
  });

  test('rejects an invalid country', async () => {
    const app = createApp({
      corsOrigins: ['http://localhost:5173'],
      feedbacksService: { listPublic: jest.fn() }
    });
    const response = await request(app).get('/api/v1/public/feedbacks?country=AR');

    expect(response.status).toBe(400);
  });

  test('requires a country', async () => {
    const app = createApp({
      corsOrigins: ['http://localhost:5173'],
      feedbacksService: { listPublic: jest.fn() }
    });
    const response = await request(app).get('/api/v1/public/feedbacks');

    expect(response.status).toBe(400);
  });
});
