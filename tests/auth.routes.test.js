const request = require('supertest');
const { createApp } = require('../src/app');
const { HttpError } = require('../src/core/http-error');

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
});
