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

  test('reports e-mail availability without cookies or bearer', async () => {
    const authService = {
      checkEmailExists: jest.fn().mockResolvedValue({ email: 'jane@example.com', exists: false })
    };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/account/email-exists')
      .send({ email: 'jane@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { email: 'jane@example.com', exists: false }
    });
    expect(authService.checkEmailExists).toHaveBeenCalledWith('jane@example.com');
  });

  test('creates a pending account with the signup envelope the modal already parses', async () => {
    const authService = {
      register: jest.fn().mockResolvedValue({
        uid: 12,
        email: 'jane@example.com',
        otp_expires_in: 900,
        requires_email_verification: true
      })
    };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'jane_doe_1234',
        email: 'jane@example.com',
        password: 'EdenBowl8',
        recaptchaToken: ''
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: {
        uid: 12,
        email: 'jane@example.com',
        otp_expires_in: 900,
        requires_email_verification: true
      }
    });
    expect(authService.register).toHaveBeenCalledWith({
      username: 'jane_doe_1234',
      email: 'jane@example.com',
      password: 'EdenBowl8',
      recaptchaToken: ''
    });
  });

  test('returns a field error when register finds an existing e-mail', async () => {
    const authService = {
      register: jest.fn().mockRejectedValue(
        new HttpError(409, 'This e-mail is already registered.', {
          code: 'account_email_exists',
          field: 'email'
        })
      )
    };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'jane_doe_1234',
        email: 'jane@example.com',
        password: 'EdenBowl8'
      });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      success: false,
      error: {
        code: 'account_email_exists',
        message: 'This e-mail is already registered.',
        data: {
          field: 'email',
          fields: { email: 'This e-mail is already registered.' }
        }
      }
    });
  });

  test('keeps uid on otp_email_failed so resend remains possible', async () => {
    const authService = {
      register: jest.fn().mockRejectedValue(
        new HttpError(503, 'Unable to send the verification code right now.', {
          code: 'otp_email_failed',
          uid: 12,
          account_created: true
        })
      )
    };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'jane_doe_1234',
        email: 'jane@example.com',
        password: 'EdenBowl8'
      });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('otp_email_failed');
    expect(response.body.error.data.uid).toBe(12);
    expect(response.body.error.data.account_created).toBe(true);
  });

  test('verifies OTP without issuing a JWT', async () => {
    const authService = {
      verifyOtp: jest.fn().mockResolvedValue({ token_endpoint: '/api/v1/auth/token' })
    };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/otp/verify')
      .send({
        uid: 12,
        otp: '847291',
        marketingOptIn: true,
        termsAccepted: true,
        privacyAccepted: true
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { token_endpoint: '/api/v1/auth/token' }
    });
    expect(response.body.data.token).toBeUndefined();
    expect(authService.verifyOtp).toHaveBeenCalledWith({
      uid: 12,
      otp: '847291',
      marketingOptIn: true,
      termsAccepted: true,
      privacyAccepted: true
    });
  });

  test('resends OTP and returns the TTL the modal uses', async () => {
    const authService = {
      resendOtp: jest.fn().mockResolvedValue({ uid: 12, otp_expires_in: 900 })
    };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/otp/resend')
      .send({ uid: 12 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: { uid: 12, otp_expires_in: 900 }
    });
  });

  test('rejects weak register passwords before calling the service', async () => {
    const authService = { register: jest.fn() };
    const app = createApp({ authService, corsOrigins });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        username: 'jane_doe_1234',
        email: 'jane@example.com',
        password: 'short'
      });

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe('Invalid request payload.');
    expect(authService.register).not.toHaveBeenCalled();
  });
});
