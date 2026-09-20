const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { ADMIN_ROLES_META_KEY, ROLE_PERMISSIONS } = require('../src/core/admin-roles');
const { ADMIN_MARKETS_META_KEY } = require('../src/core/admin-market-scope');
const { AdminIdentityService } = require('../src/services/admin-identity.service');

const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
const corsOrigins = ['http://localhost:5174'];

function tokenFor(userId = 7) {
  return issueJwtToken(
    { data: { user: { id: userId } } },
    { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
  );
}

function adminApp(overrides = {}) {
  return createApp({
    corsOrigins,
    jwt,
    adminIdentityService: {
      requireOperational: jest.fn().mockResolvedValue({
        userId: '7',
        email: 'admin@edenbowls.com',
        roles: ['admin'],
        markets: ['BR', 'US'],
        permissions: [...ROLE_PERMISSIONS.admin, 'market.br', 'market.us']
      })
    },
    authService: {
      assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7 })
    },
    ...overrides
  });
}

describe('admin me and nutrition routes', () => {
  test('returns 401 without bearer on /admin/me', async () => {
    const app = adminApp();
    const response = await request(app).get('/api/v1/admin/me');
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'Authentication is required.' });
  });

  test('returns admin identity on /admin/me', async () => {
    const app = adminApp();
    const response = await request(app)
      .get('/api/v1/admin/me')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(200);
    expect(response.body.email).toBe('admin@edenbowls.com');
    expect(response.body.roles).toContain('admin');
    expect(response.body.markets).toEqual(['BR', 'US']);
    expect(response.body.permissions).toContain('nutrition.simulate');
    expect(response.body.permissions).toContain('market.br');
    expect(response.body.permissions).toContain('market.us');
  });

  test('resolves stored operator markets without putting them on ROLE_PERMISSIONS', async () => {
    const identityService = new AdminIdentityService({
      authRepository: {
        findUserById: async () => ({ id: 9, user_email: 'op@edenbowls.com', activation_status: 'active' }),
        getUserMeta: async (_id, key) => {
          if (key === ADMIN_ROLES_META_KEY) {
            return '["operator"]';
          }
          if (key === ADMIN_MARKETS_META_KEY) {
            return '["BR"]';
          }
          return '';
        }
      }
    });

    const identity = await identityService.resolve(9);
    expect(identity.markets).toEqual(['BR']);
    expect(identity.permissions).toContain('market.br');
    expect(identity.permissions).not.toContain('market.us');
    expect(ROLE_PERMISSIONS.operator).not.toContain('market.br');
  });

  test('flag on still lets unassigned staff reach /admin/me', async () => {
    const previous = process.env.ADMIN_ENFORCE_STAFF_MARKET;
    process.env.ADMIN_ENFORCE_STAFF_MARKET = 'true';
    const app = adminApp({
      adminIdentityService: {
        requireOperational: jest.fn().mockResolvedValue({
          userId: '11',
          email: 'op@edenbowls.com',
          roles: ['operator'],
          markets: [],
          permissions: ROLE_PERMISSIONS.operator
        })
      }
    });

    try {
      const response = await request(app)
        .get('/api/v1/admin/me')
        .set('Authorization', `Bearer ${tokenFor(11)}`);

      expect(response.status).toBe(200);
      expect(response.body.email).toBe('op@edenbowls.com');
      expect(response.body.markets).toEqual([]);
    } finally {
      if (previous == null) {
        delete process.env.ADMIN_ENFORCE_STAFF_MARKET;
      } else {
        process.env.ADMIN_ENFORCE_STAFF_MARKET = previous;
      }
    }
  });

  test('forbids customer identities', async () => {
    const app = adminApp({
      adminIdentityService: {
        requireOperational: jest.fn().mockRejectedValue(Object.assign(new Error('Forbidden.'), { statusCode: 403 }))
      }
    });
    const { HttpError } = require('../src/core/http-error');
    const forbiddenApp = createApp({
      corsOrigins,
      jwt,
      adminIdentityService: {
        requireOperational: jest.fn().mockRejectedValue(new HttpError(403, 'Forbidden.'))
      }
    });

    const response = await request(forbiddenApp)
      .get('/api/v1/admin/me')
      .set('Authorization', `Bearer ${tokenFor()}`);

    expect(response.status).toBe(403);
    expect(response.body.success).toBe(false);
    expect(app).toBeTruthy();
  });

  test('simulates nutrition without persisting', async () => {
    const adminNutritionService = {
      simulate: jest.fn().mockReturnValue({
        success: true,
        data: {
          energia_kcal_dia: 805,
          quantidade_g_dia: 224,
          refeicoes: 2,
          quantidade_por_refeicao: 112,
          fator_aplicado: 85,
          porte: 'medio',
          especie: 'cao',
          nem_kcal_kg: 3600,
          display: { daily: '7.9 oz/day', weight: '44.09 lb' }
        }
      })
    };
    const app = adminApp({ adminNutritionService });
    const response = await request(app)
      .post('/api/v1/admin/nutrition/simulate')
      .set('Authorization', `Bearer ${tokenFor()}`)
      .send({
        country: 'US',
        pet: { type: 'dog', life_stage: 'adult', weight: 20, neutered: true },
        questionnaire: { nivel_atividade: 'BAIXO', score_corporal: 'ADEQUADO' }
      });

    expect(response.status).toBe(200);
    expect(response.body.data.nem_kcal_kg).toBe(3600);
    expect(adminNutritionService.simulate).toHaveBeenCalled();
  });
});
