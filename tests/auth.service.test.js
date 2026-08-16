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

  test('reports whether an e-mail is already registered', async () => {
    const repository = { emailExists: jest.fn().mockResolvedValue(true) };
    const service = new AuthService(repository);

    await expect(service.checkEmailExists('jane@example.com')).resolves.toEqual({
      email: 'jane@example.com',
      exists: true
    });
  });

  test('creates a pending user, stores only the OTP hash, and e-mails the code', async () => {
    const repository = {
      emailExists: jest.fn().mockResolvedValue(false),
      createPendingUser: jest.fn().mockResolvedValue({ id: 12, user_email: 'jane@example.com' })
    };
    const otpMailer = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret' },
      otpMailer,
      otpTtlSeconds: 600,
      hashPassword: (password) => `hashed:${password}`,
      randomOtp: () => '847291',
      nowProvider: () => 1722990000
    });

    await expect(service.register({
      username: 'jane_doe_1234',
      email: 'jane@example.com',
      password: 'EdenBowl8'
    })).resolves.toEqual({
      uid: 12,
      email: 'jane@example.com',
      otp_expires_in: 900,
      requires_email_verification: true
    });

    expect(repository.createPendingUser).toHaveBeenCalledWith(expect.objectContaining({
      userLogin: 'jane_doe_1234',
      userPass: 'hashed:EdenBowl8',
      userEmail: 'jane@example.com',
      otpExpiresAt: 1722990900
    }));
    expect(repository.createPendingUser.mock.calls[0][0].otpHash).not.toBe('847291');
    expect(otpMailer.sendOtpEmail).toHaveBeenCalledWith({
      to: 'jane@example.com',
      otp: '847291',
      expiresInSeconds: 900
    });
  });

  test('keeps the pending account and returns otp_email_failed with uid when e-mail sending fails', async () => {
    const repository = {
      emailExists: jest.fn().mockResolvedValue(false),
      createPendingUser: jest.fn().mockResolvedValue({ id: 12, user_email: 'jane@example.com' })
    };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret' },
      otpMailer: { sendOtpEmail: jest.fn().mockRejectedValue(new Error('smtp down')) },
      hashPassword: (password) => password,
      randomOtp: () => '847291'
    });

    await expect(service.register({
      username: 'jane_doe_1234',
      email: 'jane@example.com',
      password: 'EdenBowl8'
    })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'otp_email_failed', uid: 12, account_created: true }
    });
    expect(repository.createPendingUser).toHaveBeenCalled();
  });

  test('activates a pending account when the OTP and terms are valid', async () => {
    const serviceProbe = new AuthService({}, { jwt: { secret: 'test-secret' } });
    const repository = {
      findUserForOtp: jest.fn().mockResolvedValue({
        id: 12,
        user_email: 'jane@example.com',
        activation_status: 'pending',
        otp_hash: serviceProbe.hashOtpValue('847291'),
        otp_expires_at: 1722990600,
        otp_attempts: 0
      }),
      activateUser: jest.fn().mockResolvedValue(undefined)
    };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret' },
      nowProvider: () => 1722990000
    });

    await expect(service.verifyOtp({
      uid: 12,
      otp: '847291',
      marketingOptIn: true,
      termsAccepted: true,
      privacyAccepted: true
    })).resolves.toEqual({
      token_endpoint: '/api/v1/auth/token'
    });
    expect(repository.activateUser).toHaveBeenCalledWith(12, {
      marketingOptIn: true,
      termsAccepted: true,
      privacyAccepted: true,
      emailVerifiedAt: '2024-08-07T00:20:00.000Z'
    });
  });

  test('rejects OTP verification without terms and does not issue a JWT', async () => {
    const repository = { findUserForOtp: jest.fn(), activateUser: jest.fn() };
    const service = new AuthService(repository);

    await expect(service.verifyOtp({
      uid: 12,
      otp: '847291',
      marketingOptIn: true,
      termsAccepted: false,
      privacyAccepted: false
    })).rejects.toMatchObject({
      details: { code: 'terms_not_accepted' }
    });
    expect(repository.findUserForOtp).not.toHaveBeenCalled();
    expect(repository.activateUser).not.toHaveBeenCalled();
  });

  test('resets OTP attempts and e-mails a new code on resend', async () => {
    const repository = {
      findUserForOtp: jest.fn().mockResolvedValue({
        id: 12,
        user_email: 'jane@example.com',
        activation_status: 'pending',
        otp_hash: 'old-hash',
        otp_expires_at: 1,
        otp_attempts: 4
      }),
      saveOtpChallenge: jest.fn().mockResolvedValue(undefined),
      saveOtpResendState: jest.fn().mockResolvedValue(undefined)
    };
    const otpMailer = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret' },
      otpMailer,
      otpTtlSeconds: 600,
      randomOtp: () => '111222',
      nowProvider: () => 1722990000
    });

    await expect(service.resendOtp({ uid: 12 })).resolves.toEqual({
      uid: 12,
      otp_expires_in: 900
    });
    expect(repository.saveOtpResendState).toHaveBeenCalledWith(12, {
      count: 1,
      windowStart: 1722990000
    });
    expect(repository.saveOtpChallenge).toHaveBeenCalledWith(12, expect.objectContaining({
      otpExpiresAt: 1722990900,
      attempts: 0
    }));
    expect(otpMailer.sendOtpEmail).toHaveBeenCalledWith({
      to: 'jane@example.com',
      otp: '111222',
      expiresInSeconds: 900
    });
  });

  test('rate-limits OTP resend to 3 attempts per hour without resetting the counter on issue', async () => {
    const repository = {
      findUserForOtp: jest.fn().mockResolvedValue({
        id: 12,
        user_email: 'jane@example.com',
        activation_status: 'pending',
        otp_hash: 'old-hash',
        otp_expires_at: 1,
        otp_attempts: 0,
        otp_resend_count: 3,
        otp_resend_window_start: 1722990000
      }),
      saveOtpChallenge: jest.fn(),
      saveOtpResendState: jest.fn()
    };
    const service = new AuthService(repository, {
      jwt: { secret: 'test-secret' },
      otpMailer: { sendOtpEmail: jest.fn() },
      nowProvider: () => 1722990000 + 10
    });

    await expect(service.resendOtp({ uid: 12 })).rejects.toMatchObject({
      statusCode: 429,
      details: { code: 'otp_resend_rate_limited' }
    });
    expect(repository.saveOtpChallenge).not.toHaveBeenCalled();
  });
});
