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
      privacyAccepted: true,
      requestContext: {}
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

const { AuthService } = require('../src/services/auth.service');

function createPasswordResetApp(nowRef) {
  const state = {
    user: {
      id: 7,
      user_email: 'ana@example.com',
      display_name: 'Ana',
      reset_count: 0,
      reset_window_start: 0,
      reset_token_hash: '',
      reset_expires_at: 0
    },
    passwordHash: ''
  };
  const repository = {
    findUserForPasswordReset: jest.fn(async (email) => {
      if (state.user.user_email !== email) {
        return null;
      }
      return { ...state.user };
    }),
    savePasswordResetRate: jest.fn(async (_id, rate) => {
      state.user.reset_count = rate.count;
      state.user.reset_window_start = rate.windowStart;
    }),
    savePasswordResetChallenge: jest.fn(async (_id, challenge) => {
      state.user.reset_token_hash = challenge.tokenHash;
      state.user.reset_expires_at = challenge.expiresAt;
    }),
    findUserByResetTokenHash: jest.fn(async (hash) => {
      if (!state.user.reset_token_hash || state.user.reset_token_hash !== hash) {
        return null;
      }
      return { ...state.user };
    }),
    completePasswordReset: jest.fn(async (_id, passwordHash) => {
      state.passwordHash = passwordHash;
      state.user.reset_token_hash = '';
      state.user.reset_expires_at = 0;
    })
  };
  const mailer = { sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined) };
  const authService = new AuthService(repository, {
    otpPepper: 'pepper',
    otpResendMaxAttempts: 3,
    otpResendWindowSeconds: 3600,
    storeAppUrl: 'https://shop.example',
    otpMailer: mailer,
    hashPassword: (value) => `hashed:${value}`,
    nowProvider: () => nowRef.now
  });
  return {
    app: createApp({ authService, corsOrigins: ['http://localhost:5173'] }),
    mailer,
    state,
    repository
  };
}

describe('password reset routes', () => {
  const successBody = { success: true, data: { accepted: true } };

  test('returns the same success body for an unknown email and omits the token', async () => {
    const { app, mailer } = createPasswordResetApp({ now: 1_700_000_000 });
    const response = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'missing@example.com' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(successBody);
    expect(mailer.sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain('token');
  });

  test('emails only a known account, keeps the generic body, and stops after the resend limit', async () => {
    const { app, mailer } = createPasswordResetApp({ now: 1_700_000_000 });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'ana@example.com' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual(successBody);
      const token = new URL(mailer.sendPasswordResetEmail.mock.calls[attempt][0].resetUrl).searchParams.get('token');
      expect(mailer.sendPasswordResetEmail.mock.calls[attempt][0].resetUrl).toContain('https://shop.example/reset-password?token=');
      expect(JSON.stringify(response.body)).not.toContain(token);
    }

    const limited = await request(app)
      .post('/api/v1/auth/password/forgot')
      .send({ email: 'ana@example.com' });
    expect(limited.status).toBe(200);
    expect(limited.body).toEqual(successBody);
    expect(mailer.sendPasswordResetEmail).toHaveBeenCalledTimes(3);
  });

  test('a second request invalidates the first token and a weak password is rejected', async () => {
    const { app, mailer, state } = createPasswordResetApp({ now: 1_700_000_000 });

    await request(app).post('/api/v1/auth/password/forgot').send({ email: 'ana@example.com' });
    const firstToken = new URL(mailer.sendPasswordResetEmail.mock.calls[0][0].resetUrl).searchParams.get('token');
    await request(app).post('/api/v1/auth/password/forgot').send({ email: 'ana@example.com' });
    const secondToken = new URL(mailer.sendPasswordResetEmail.mock.calls[1][0].resetUrl).searchParams.get('token');

    const weak = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: secondToken, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.body.message).toBe('Invalid request payload.');
    expect(state.passwordHash).toBe('');

    const stale = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: firstToken, password: 'NewPass1' });
    expect(stale.status).toBe(400);
    expect(stale.body.error.code).toBe('password_reset_invalid');

    const fresh = await request(app)
      .post('/api/v1/auth/password/reset')
      .send({ token: secondToken, password: 'NewPass1' });
    expect(fresh.status).toBe(200);
    expect(fresh.body).toEqual({ success: true, data: { updated: true } });
    expect(JSON.stringify(fresh.body)).not.toContain(secondToken);
    expect(state.passwordHash).toBe('hashed:NewPass1');
  });
});
