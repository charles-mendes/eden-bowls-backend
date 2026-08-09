const { AuthService } = require('../src/services/auth.service');

function createRepository(user) {
  return {
    findUserForAuthentication: jest.fn().mockResolvedValue(user)
  };
}

describe('AuthService', () => {
  test('returns token payload for active user with valid password', async () => {
    const repository = createRepository({
      id: 1,
      user_login: 'demo',
      user_pass: 'e10adc3949ba59abbe56e057f20f883e',
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      display_name: 'Demo User',
      activation_status: 'active'
    });

    const service = new AuthService(repository, {
      jwt: {
        secret: 'test-secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        expiresInSeconds: 3600
      },
      nowProvider: () => 1722990000
    });

    const response = await service.authenticate({ username: 'demo', password: '123456' });

    expect(typeof response.token).toBe('string');
    expect(response.user_email).toBe('demo@example.com');
    expect(response.user_nicename).toBe('demo');
    expect(response.user_display_name).toBe('Demo User');
  });

  test('rejects invalid credentials', async () => {
    const repository = createRepository({
      id: 1,
      user_login: 'demo',
      user_pass: 'e10adc3949ba59abbe56e057f20f883e',
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      display_name: 'Demo User',
      activation_status: 'active'
    });

    const service = new AuthService(repository, {
      jwt: {
        secret: 'test-secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        expiresInSeconds: 3600
      }
    });

    await expect(service.authenticate({ username: 'demo', password: 'wrong' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Invalid username or password.',
      details: { code: 'wp_authentication_failed' }
    });
  });

  test('rejects users pending activation', async () => {
    const repository = createRepository({
      id: 2,
      user_login: 'pending',
      user_pass: 'e10adc3949ba59abbe56e057f20f883e',
      user_email: 'pending@example.com',
      user_nicename: 'pending',
      display_name: 'Pending User',
      activation_status: 'pending'
    });

    const service = new AuthService(repository, {
      jwt: {
        secret: 'test-secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        expiresInSeconds: 3600
      }
    });

    await expect(service.authenticate({ username: 'pending', password: '123456' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'Account pending activation.',
      details: { code: 'account_pending_activation' }
    });
  });

  test('rejects missing jwt secret', async () => {
    const repository = createRepository({
      id: 1,
      user_login: 'demo',
      user_pass: 'e10adc3949ba59abbe56e057f20f883e',
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      display_name: 'Demo User',
      activation_status: 'active'
    });

    const service = new AuthService(repository, {
      jwt: {
        secret: '',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        expiresInSeconds: 3600
      }
    });

    await expect(service.authenticate({ username: 'demo', password: '123456' })).rejects.toMatchObject({
      statusCode: 403,
      message: 'JWT is not configured properly.',
      details: { code: 'jwt_auth_bad_config' }
    });
  });
});
