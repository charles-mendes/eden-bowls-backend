const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function adminApp(overrides = {}) {
  return createApp({
    corsOrigins: ['http://localhost:5174'],
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'admin@edenbowls.com',
        roles: ['admin'],
        permissions: ROLE_PERMISSIONS.admin
      })
    },
    ...overrides
  });
}

const feedback = {
  id: 3,
  name: 'João Silva',
  category: 'tutor',
  country: 'BR',
  photo: '',
  place: 'São Paulo',
  comment: 'Excelente.',
  active: true,
  createdAt: '2026-08-20T12:00:00.000Z',
  updatedAt: '2026-08-20T12:00:00.000Z'
};

describe('admin feedback routes', () => {
  test('lists feedbacks with country filter', async () => {
    const feedbacksService = {
      list: jest.fn().mockResolvedValue({
        total: 1,
        page: 1,
        perPage: 20,
        totalPages: 1,
        items: [feedback]
      })
    };
    const app = adminApp({ feedbacksService });
    const response = await request(app)
      .get('/api/v1/admin/feedbacks?country=BR')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].name).toBe('João Silva');
    expect(feedbacksService.list).toHaveBeenCalledWith(expect.objectContaining({
      country: 'BR',
      page: 1
    }));
  });

  test('creates a feedback', async () => {
    const feedbacksService = {
      create: jest.fn().mockResolvedValue(feedback)
    };
    const app = adminApp({ feedbacksService });
    const response = await request(app)
      .post('/api/v1/admin/feedbacks')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({
        name: 'João Silva',
        category: 'tutor',
        country: 'BR',
        place: 'São Paulo',
        comment: 'Excelente.',
        active: true,
        photo: { mimeType: 'image/png', imageBase64: PNG_BASE64 }
      });

    expect(response.status).toBe(200);
    expect(feedbacksService.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'João Silva',
      category: 'tutor',
      country: 'BR'
    }));
  });

  test('toggles active status', async () => {
    const feedbacksService = {
      setActive: jest.fn().mockResolvedValue({ ...feedback, active: false })
    };
    const app = adminApp({ feedbacksService });
    const response = await request(app)
      .patch('/api/v1/admin/feedbacks/3/active')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(feedbacksService.setActive).toHaveBeenCalledWith(3, false);
    expect(response.body.active).toBe(false);
  });

  test('forbids readonly from creating feedbacks', async () => {
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '9',
          email: 'read@edenbowls.com',
          roles: ['readonly'],
          permissions: ROLE_PERMISSIONS.readonly
        })
      },
      feedbacksService: { create: jest.fn() }
    });
    const response = await request(app)
      .post('/api/v1/admin/feedbacks')
      .set('Authorization', `Bearer ${tokenFor(9)}`)
      .send({
        name: 'João Silva',
        category: 'tutor',
        country: 'BR',
        comment: 'Excelente.'
      });

    expect(response.status).toBe(403);
  });
});
