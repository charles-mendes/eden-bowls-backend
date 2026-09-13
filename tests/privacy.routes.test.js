const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { HttpError } = require('../src/core/http-error');

const corsOrigins = ['http://localhost:5173'];
const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

function issueAccessToken(userId) {
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

describe('privacy customer routes', () => {
  test('updates marketing opt-in for the authenticated user', async () => {
    const privacyService = {
      contextFromRequest: jest.fn().mockReturnValue({ ipHash: 'h', userAgent: 'ua' }),
      setMarketing: jest.fn().mockResolvedValue({ marketingOptIn: true })
    };
    const app = createApp({ privacyService, corsOrigins, jwt });
    const response = await request(app)
      .put('/api/v1/profile/marketing')
      .set('Authorization', `Bearer ${issueAccessToken(77)}`)
      .send({ marketingOptIn: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { marketingOptIn: true } });
    expect(privacyService.setMarketing).toHaveBeenCalledWith(expect.objectContaining({
      userId: 77,
      marketingOptIn: true
    }));
  });

  test('creates an authenticated access request', async () => {
    const privacyService = {
      contextFromRequest: jest.fn().mockReturnValue({ ipHash: 'h', userAgent: 'ua' }),
      createCustomerRequest: jest.fn().mockResolvedValue({
        id: 9,
        type: 'access',
        status: 'completed',
        dueAt: '2026-01-16T00:00:00.000Z'
      })
    };
    const app = createApp({ privacyService, corsOrigins, jwt });
    const response = await request(app)
      .post('/api/v1/privacy/requests')
      .set('Authorization', `Bearer ${issueAccessToken(77)}`)
      .set('X-Eden-Domain', 'com.br')
      .send({ type: 'access' });

    expect(response.status).toBe(201);
    expect(privacyService.createCustomerRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: 77,
      type: 'access',
      market: 'BR'
    }));
  });

  test('requires authentication to list consents', async () => {
    const privacyService = { listConsents: jest.fn() };
    const app = createApp({ privacyService, corsOrigins, jwt });
    const response = await request(app).get('/api/v1/privacy/consents');
    expect(response.status).toBe(401);
    expect(privacyService.listConsents).not.toHaveBeenCalled();
  });
});

describe('admin privacy routes', () => {
  test('lists requests for operators with read permission', async () => {
    const privacyService = {
      listAdminRequests: jest.fn().mockResolvedValue({
        total: 1,
        items: [{ id: 41, type: 'access', overdue: true, payload: { package: { secret: true } } }]
      })
    };
    const app = adminApp({ privacyService });
    const response = await request(app)
      .get('/api/v1/admin/privacy/requests?overdue=true')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`);

    expect(response.status).toBe(200);
    expect(response.body.items[0].id).toBe(41);
    expect(privacyService.listAdminRequests).toHaveBeenCalledWith(expect.objectContaining({
      overdue: true
    }), expect.any(Object));
  });

  test('blocks completing an unverified DSAR', async () => {
    const privacyService = {
      completeRequest: jest.fn().mockRejectedValue(new HttpError(422, 'Identity must be verified before completing this request.', {
        code: 'identity_unverified'
      }))
    };
    const app = adminApp({ privacyService });
    const response = await request(app)
      .post('/api/v1/admin/privacy/requests/41/complete')
      .set('Authorization', `Bearer ${issueAccessToken(7)}`)
      .send({ note: 'ok' });

    expect(response.status).toBe(422);
    expect(response.body.details.code).toBe('identity_unverified');
  });

  test('forbids nutritionist from the privacy queue', async () => {
    const privacyService = { listAdminRequests: jest.fn() };
    const app = createApp({
      corsOrigins: ['http://localhost:5174'],
      jwt,
      privacyService,
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '8',
          email: 'nutri@edenbowls.com',
          roles: ['nutritionist'],
          permissions: ROLE_PERMISSIONS.nutritionist
        })
      }
    });

    const response = await request(app)
      .get('/api/v1/admin/privacy/requests')
      .set('Authorization', `Bearer ${issueAccessToken(8)}`);

    expect(response.status).toBe(403);
    expect(privacyService.listAdminRequests).not.toHaveBeenCalled();
  });
});
