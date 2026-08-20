const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');

describe('bearer token middleware', () => {
  const corsOrigins = ['http://localhost:5173'];
  const jwt = {
    secret: 'test-secret',
    algorithm: 'HS256',
    issuer: 'http://localhost:3000'
  };

  test('keeps public API route accessible without authorization header', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({ success: true, data: { items: [] } })
    };

    const app = createApp({ breedsService, corsOrigins, jwt });
    const response = await request(app).get('/api/v1/breeds');

    expect(response.status).toBe(200);
    expect(breedsService.listBreeds).toHaveBeenCalled();
  });

  test('rejects malformed bearer header on api routes', async () => {
    const breedsService = {
      listBreeds: jest.fn()
    };

    const app = createApp({ breedsService, corsOrigins, jwt });
    const response = await request(app)
      .get('/api/v1/breeds')
      .set('Authorization', 'Token abc');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: 'Authorization header malformed.',
      details: { code: 'jwt_auth_bad_auth_header' }
    });
    expect(breedsService.listBreeds).not.toHaveBeenCalled();
  });

  test('accepts valid bearer token on api routes', async () => {
    const breedsService = {
      listBreeds: jest.fn().mockResolvedValue({ success: true, data: { items: [] } })
    };
    const token = issueJwtToken(
      {
        data: {
          user: {
            id: 1
          }
        }
      },
      {
        secret: jwt.secret,
        algorithm: jwt.algorithm,
        issuer: jwt.issuer,
        now: Math.floor(Date.now() / 1000),
        ttlSeconds: 3600
      }
    );

    const app = createApp({ breedsService, corsOrigins, jwt });
    const response = await request(app)
      .get('/api/v1/breeds')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(breedsService.listBreeds).toHaveBeenCalled();
  });

  test('does not apply bearer validation to auth token endpoint', async () => {
    const authService = {
      authenticate: jest.fn().mockResolvedValue({
        token: 'jwt-token',
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        user_display_name: 'Demo User'
      })
    };

    const app = createApp({ authService, corsOrigins, jwt });
    const response = await request(app)
      .post('/api/v1/auth/token')
      .set('Authorization', 'Token invalid')
      .send({ username: 'demo', password: 'demo123' });

    expect(response.status).toBe(200);
    expect(authService.authenticate).toHaveBeenCalled();
  });

  test('does not apply bearer validation to register and OTP endpoints', async () => {
    const authService = {
      register: jest.fn().mockResolvedValue({
        uid: 12,
        email: 'jane@example.com',
        otp_expires_in: 900
      })
    };
    const app = createApp({ authService, corsOrigins, jwt });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Authorization', 'Token invalid')
      .send({
        username: 'jane_doe_1234',
        email: 'jane@example.com',
        password: 'EdenBowl8'
      });

    expect(response.status).toBe(201);
    expect(authService.register).toHaveBeenCalled();
  });

  test('does not apply bearer validation to refresh and logout', async () => {
    const authService = {
      refresh: jest.fn().mockResolvedValue({
        token: 'next-access-token',
        refreshToken: 'next-refresh-token'
      })
    };
    const app = createApp({ authService, corsOrigins, jwt });
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Authorization', 'Token invalid')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest');

    expect(response.status).toBe(200);
    expect(authService.refresh).toHaveBeenCalledWith('');
  });

  test('does not apply bearer validation to geo context', async () => {
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

    const app = createApp({ geoService, corsOrigins, jwt });
    const response = await request(app)
      .get('/api/v1/geo/context')
      .set('Authorization', 'Token invalid');

    expect(response.status).toBe(200);
    expect(geoService.getContext).toHaveBeenCalled();
  });
});
