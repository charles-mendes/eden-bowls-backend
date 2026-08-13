const { AuthRefreshTokenRepository } = require('../src/infrastructure/repositories/auth-refresh-token.repository');

describe('AuthRefreshTokenRepository', () => {
  const now = '2026-08-12 12:00:00';

  test('persists only the supplied token hash and refresh ownership metadata', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new AuthRefreshTokenRepository(dataSource);

    await repository.create({
      id: 'token-1',
      userId: 7,
      familyId: 'family-1',
      tokenHash: 'a'.repeat(64),
      expiresAt: '2026-09-11 12:00:00'
    });

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('`token_hash`'),
      ['token-1', 7, 'family-1', 'a'.repeat(64), '2026-09-11 12:00:00']
    );
    expect(dataSource.query.mock.calls[0][0]).not.toContain('token_value');
  });

  test('marks rotation only while the presented token remains active and unrotated', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new AuthRefreshTokenRepository(dataSource);

    const updated = await repository.markRotated({
      id: 'token-1',
      replacementId: 'token-2',
      now,
      replayGraceUntil: '2026-08-12 12:00:05'
    });

    expect(updated).toBe(true);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('`replaced_by_id` IS NULL AND `revoked_at` IS NULL AND `expires_at` > ?'),
      ['token-2', '2026-08-12 12:00:05', now, 'token-1', now]
    );
  });

  test('consumes the replay grace period at most once', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue({ affectedRows: 0 })
    };
    const repository = new AuthRefreshTokenRepository(dataSource);

    const consumed = await repository.consumeReplayGrace({ id: 'token-1', now });

    expect(consumed).toBe(false);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('`replay_consumed_at` IS NULL'),
      [now, now, 'token-1', now]
    );
  });

  test('revokes only active tokens belonging to the requested family or user', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest
        .fn()
        .mockResolvedValueOnce({ affectedRows: 2 })
        .mockResolvedValueOnce({ affectedRows: 3 })
    };
    const repository = new AuthRefreshTokenRepository(dataSource);

    await expect(repository.revokeFamily('family-1', 'reuse_detected', now)).resolves.toBe(2);
    await expect(repository.revokeAllForUser(7, 'password_changed', now)).resolves.toBe(3);

    expect(dataSource.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('WHERE `family_id` = ? AND `revoked_at` IS NULL'),
      [now, 'reuse_detected', 'family-1']
    );
    expect(dataSource.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('WHERE `user_id` = ? AND `revoked_at` IS NULL'),
      [now, 'password_changed', 7]
    );
  });

  test('rotates an active token in one transaction while locking the source row', async () => {
    const sourceRow = {
      id: 'token-1',
      user_id: 7,
      family_id: 'family-1',
      token_hash: 'a'.repeat(64),
      replaced_by_id: null,
      replay_grace_until: null,
      replay_consumed_at: null,
      expires_at: '2026-09-11 12:00:00',
      last_used_at: null,
      revoked_at: null,
      revoked_reason: null
    };
    const manager = {
      query: jest
        .fn()
        .mockResolvedValueOnce([sourceRow])
        .mockResolvedValueOnce({ affectedRows: 1 })
        .mockResolvedValueOnce({ affectedRows: 1 })
    };
    const dataSource = {
      isInitialized: true,
      transaction: jest.fn(async (callback) => callback(manager))
    };
    const repository = new AuthRefreshTokenRepository(dataSource);

    const result = await repository.rotateAtomically({
      tokenHash: 'a'.repeat(64),
      successor: {
        id: 'token-2',
        userId: 7,
        familyId: 'family-1',
        tokenHash: 'b'.repeat(64),
        expiresAt: '2026-09-12 12:00:00'
      },
      now,
      replayGraceUntil: '2026-08-12 12:00:05'
    });

    expect(result.status).toBe('rotated');
    expect(result.successor.id).toBe('token-2');
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      ['a'.repeat(64)]
    );
    expect(manager.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO `auth_refresh_tokens`'),
      ['token-2', 7, 'family-1', 'b'.repeat(64), '2026-09-12 12:00:00']
    );
  });
});