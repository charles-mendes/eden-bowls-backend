const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/core/http-error');
const { issueJwtToken } = require('../src/core/jwt-token');

describe('auth routes', () => {
  const corsOrigins = ['http://localhost:5173'];

  test('returns jwt token contract on success', async () => {
    const authService = {
      authenticate: jest.fn().mockResolvedValue({
        token: 'jwt-token',
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        user_display_name: 'Demo User'
      })
    };

    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/token')
      .send({ username: 'demo', password: 'demo123' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      token: 'jwt-token',
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      user_display_name: 'Demo User'
    });
    expect(authService.authenticate).toHaveBeenCalledWith({ username: 'demo', password: 'demo123' });
  });

  test('sets an HttpOnly refresh cookie without exposing it in the JSON response', async () => {
    const authService = {
      authenticate: jest.fn().mockResolvedValue({
        token: 'jwt-token',
        refreshToken: 'opaque-refresh-token',
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        user_display_name: 'Demo User'
      })
    };
    const app = createApp({
      authService,
      corsOrigins,
      authCookie: {
        name: 'eden_refresh_token',
        path: '/api/v1/auth',
        sameSite: 'lax',
        secure: true,
        maxAgeSeconds: 2592000
      }
    });

    const response = await request(app)
      .post('/api/v1/auth/token')
      .send({ username: 'demo', password: 'demo123' });

    expect(response.status).toBe(200);
    expect(response.body.refreshToken).toBeUndefined();
    expect(response.headers['set-cookie'][0]).toContain('eden_refresh_token=opaque-refresh-token');
    expect(response.headers['set-cookie'][0]).toContain('Path=/api/v1/auth');
    expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(response.headers['set-cookie'][0]).toContain('SameSite=Lax');
    expect(response.headers['set-cookie'][0]).toContain('Secure');
  });

  test('returns wp-like auth error on invalid credentials', async () => {
    const authService = {
      authenticate: jest.fn().mockRejectedValue(
        new HttpError(403, 'Invalid username or password.', {
          code: 'wp_authentication_failed'
        })
      )
    };

    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/token')
      .send({ username: 'demo', password: 'wrong' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      code: 'wp_authentication_failed',
      message: 'Invalid username or password.',
      data: { status: 403 }
    });
  });

  test('validates required username and password', async () => {
    const authService = {
      authenticate: jest.fn()
    };

    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/token')
      .send({ username: '', password: '' });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid request payload.');
    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  test('returns the current user only for a valid bearer token', async () => {
    const authService = {
      getCurrentUser: jest.fn().mockResolvedValue({
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        user_display_name: 'Demo User'
      })
    };
    const jwt = { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
    const token = issueJwtToken(
      { data: { user: { id: 7 } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
    const app = createApp({ authService, corsOrigins, jwt });

    const unauthenticated = await request(app).get('/api/v1/auth/me');
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body.code).toBe('unauthorized');

    const authenticated = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(authenticated.status).toBe(200);
    expect(authenticated.body).toEqual({
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      user_display_name: 'Demo User'
    });
    expect(authService.getCurrentUser).toHaveBeenCalledWith(7);
  });

  test('refreshes from the HttpOnly cookie only with the expected CSRF headers', async () => {
    const authService = {
      refresh: jest.fn().mockResolvedValue({
        token: 'next-access-token',
        refreshToken: 'next-refresh-token',
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        user_display_name: 'Demo User'
      })
    };
    const app = createApp({
      authService,
      corsOrigins,
      authCookie: { name: 'eden_refresh_token', path: '/api/v1/auth', sameSite: 'lax', maxAgeSeconds: 2592000 }
    });

    const rejected = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'eden_refresh_token=previous-refresh-token');
    expect(rejected.status).toBe(403);
    expect(rejected.body.code).toBe('csrf_request_rejected');

    const refreshed = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', 'eden_refresh_token=previous-refresh-token');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body).toEqual({
      token: 'next-access-token',
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      user_display_name: 'Demo User'
    });
    expect(refreshed.headers['set-cookie'][0]).toContain('eden_refresh_token=next-refresh-token');
    expect(authService.refresh).toHaveBeenCalledWith('previous-refresh-token');
  });

  test('revokes through logout and clears the refresh cookie', async () => {
    const authService = { logout: jest.fn().mockResolvedValue(undefined) };
    const app = createApp({
      authService,
      corsOrigins,
      authCookie: { name: 'eden_refresh_token', path: '/api/v1/auth', sameSite: 'lax', maxAgeSeconds: 2592000 }
    });

    const response = await request(app)
      .post('/api/v1/auth/logout')
      .set('Origin', 'http://localhost:5173')
      .set('X-Requested-With', 'XMLHttpRequest')
      .set('Cookie', 'eden_refresh_token=previous-refresh-token');

    expect(response.status).toBe(204);
    expect(response.headers['set-cookie'][0]).toContain('eden_refresh_token=');
    expect(response.headers['set-cookie'][0]).toContain('Max-Age=0');
    expect(authService.logout).toHaveBeenCalledWith('previous-refresh-token');
  });

  test('allows credentialed CORS preflight for refresh from an exact allowed origin', async () => {
    const app = createApp({ corsOrigins });

    const response = await request(app)
      .options('/api/v1/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-requested-with');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']).toContain('X-Requested-With');
    expect(response.headers['access-control-allow-headers']).not.toContain('x-session-token');
  });
});
