const { AuthRepository } = require('../src/infrastructure/repositories/auth.repository');

describe('AuthRepository registration helpers', () => {
  test('looks up e-mail existence case-insensitively', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ id: 1 }])
    };
    const repository = new AuthRepository(dataSource);

    await expect(repository.emailExists('Jane@Example.com')).resolves.toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(u.user_email) = ?'),
      ['jane@example.com']
    );
  });

  test('creates a pending user and writes activation plus hashed OTP metas', async () => {
    const manager = {
      query: jest.fn()
        .mockResolvedValueOnce({ insertId: 12 })
        .mockResolvedValue([])
    };
    const dataSource = {
      isInitialized: true,
      transaction: async (callback) => callback(manager)
    };
    const repository = new AuthRepository(dataSource);

    await expect(repository.createPendingUser({
      userLogin: 'jane_doe_1234',
      userPass: 'hashed',
      userNicename: 'jane-doe-1234',
      userEmail: 'jane@example.com',
      displayName: 'jane_doe_1234',
      otpHash: 'otp-hash',
      otpExpiresAt: 1722990600
    })).resolves.toEqual({
      id: 12,
      user_email: 'jane@example.com'
    });

    expect(manager.query.mock.calls[0][0]).toContain('INSERT INTO `wp_users`');
    expect(manager.query.mock.calls.some((call) => String(call[1] && call[1][1]) === 'hsr_activation_status' && call[1][2] === 'pending')).toBe(true);
    expect(manager.query.mock.calls.some((call) => String(call[1] && call[1][1]) === 'hsr_otp_hash' && call[1][2] === 'otp-hash')).toBe(true);
  });

  test('authenticates by e-mail regardless of casing', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{
        id: 1,
        user_login: 'demo',
        user_pass: 'hash',
        user_email: 'demo@example.com',
        user_nicename: 'demo',
        display_name: 'Demo User',
        activation_status: 'active'
      }])
    };
    const repository = new AuthRepository(dataSource);

    await repository.findUserForAuthentication('Demo@Example.com');

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(u.user_email) = LOWER(?)'),
      ['Demo@Example.com', 'Demo@Example.com']
    );
  });
});
