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

  test('creates an opaque refresh token while persisting only its hash', async () => {
    const repository = createRepository({
      id: 1,
      user_login: 'demo',
      user_pass: 'e10adc3949ba59abbe56e057f20f883e',
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      display_name: 'Demo User',
      activation_status: 'active'
    });
    const refreshTokenRepository = { create: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(repository, {
      jwt: {
        secret: 'test-secret',
        algorithm: 'HS256',
        issuer: 'http://localhost:3000',
        expiresInSeconds: 900
      },
      refreshTokenRepository,
      refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
      nowProvider: () => 1722990000
    });

    const response = await service.authenticate({ username: 'demo', password: '123456' });

    expect(response.refreshToken).toEqual(expect.any(String));
    expect(response.refreshToken.length).toBeGreaterThan(64);
    expect(refreshTokenRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      userId: 1,
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: '2024-09-06 00:20:00'
    }));
    expect(refreshTokenRepository.create.mock.calls[0][0].tokenHash).not.toBe(response.refreshToken);
  });

  test('returns current active user identity by id', async () => {
    const repository = {
      findUserById: jest.fn().mockResolvedValue({
        id: 1,
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        display_name: 'Demo User',
        activation_status: 'active'
      })
    };
    const service = new AuthService(repository);

    await expect(service.getCurrentUser(1)).resolves.toEqual({
      user_email: 'demo@example.com',
      user_nicename: 'demo',
      user_display_name: 'Demo User'
    });
    expect(repository.findUserById).toHaveBeenCalledWith(1);
  });

  test('blocks suspended users from critical operations using a fresh user lookup', async () => {
    const repository = {
      findUserById: jest.fn().mockResolvedValue({ id: 1, activation_status: 'suspended' })
    };
    const service = new AuthService(repository);

    await expect(service.assertCriticalOperationAllowed(1)).rejects.toMatchObject({
      statusCode: 403,
      details: { code: 'account_operation_not_allowed' }
    });
    expect(repository.findUserById).toHaveBeenCalledWith(1);
  });

  test('allows active users to perform critical operations', async () => {
    const user = { id: 1, activation_status: 'active' };
    const repository = { findUserById: jest.fn().mockResolvedValue(user) };
    const service = new AuthService(repository);

    await expect(service.assertCriticalOperationAllowed(1)).resolves.toBe(user);
  });

  test('rotates a refresh token and returns a new opaque cookie value', async () => {
    const repository = {
      findUserById: jest.fn().mockResolvedValue({
        id: 1,
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        display_name: 'Demo User',
        activation_status: 'active'
      })
    };
    const refreshTokenRepository = {
      rotateAtomically: jest.fn().mockResolvedValue({
        status: 'rotated',
        source: { userId: 1, familyId: 'family-1' }
      })
    };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000', expiresInSeconds: 900 },
      refreshTokenRepository,
      nowProvider: () => 1722990000
    });

    const response = await service.refresh('previous-refresh-token');

    expect(response.token).toEqual(expect.any(String));
    expect(response.refreshToken).toEqual(expect.any(String));
    expect(refreshTokenRepository.rotateAtomically).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: service.hashRefreshToken('previous-refresh-token'),
      now: '2024-08-07 00:20:00',
      replayGraceUntil: '2024-08-07 00:20:05'
    }));
  });

  test('does not mint a second refresh token for the one-time grace replay', async () => {
    const repository = {
      findUserById: jest.fn().mockResolvedValue({
        id: 1,
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        display_name: 'Demo User',
        activation_status: 'active'
      })
    };
    const refreshTokenRepository = {
      rotateAtomically: jest.fn().mockResolvedValue({
        status: 'grace_replay',
        source: { userId: 1, familyId: 'family-1' }
      })
    };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret', algorithm: 'HS256', issuer: 'http://localhost:3000', expiresInSeconds: 900 },
      refreshTokenRepository,
      nowProvider: () => 1722990000
    });

    const response = await service.refresh('previous-refresh-token');

    expect(response.token).toEqual(expect.any(String));
    expect(response.refreshToken).toBeNull();
  });

  test('revokes the token family when refresh-token reuse is detected', async () => {
    const refreshTokenRepository = {
      rotateAtomically: jest.fn().mockResolvedValue({
        status: 'reuse',
        source: { userId: 1, familyId: 'family-1' }
      }),
      revokeFamily: jest.fn().mockResolvedValue(2)
    };
    const service = new AuthService({}, { refreshTokenRepository, nowProvider: () => 1722990000 });

    await expect(service.refresh('reused-token')).rejects.toMatchObject({
      statusCode: 401,
      details: { code: 'refresh_token_reused' }
    });
    expect(refreshTokenRepository.revokeFamily).toHaveBeenCalledWith(
      'family-1',
      'reuse_detected',
      '2024-08-07 00:20:00'
    );
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
