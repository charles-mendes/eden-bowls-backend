const { CreateAuthRefreshTokensTable1700000000005 } = require('../src/infrastructure/migrations/1700000000005-create-auth-refresh-tokens-table');

describe('CreateAuthRefreshTokensTable1700000000005', () => {
  test('creates hash-only refresh token storage with family and expiry indexes', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined),
      createForeignKey: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined)
    };

    const migration = new CreateAuthRefreshTokensTable1700000000005();
    await migration.up(queryRunner);

    const table = queryRunner.createTable.mock.calls[0][0];
    const columns = table.columns;

    expect(table.name).toBe('auth_refresh_tokens');
    expect(columns).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'token_hash', type: 'char', length: '64', isUnique: true }),
      expect.objectContaining({ name: 'family_id' }),
      expect.objectContaining({ name: 'replaced_by_id' }),
      expect.objectContaining({ name: 'replay_grace_until' }),
      expect.objectContaining({ name: 'replay_consumed_at' }),
      expect.objectContaining({ name: 'revoked_at' })
    ]));

    expect(queryRunner.createForeignKey).toHaveBeenCalledWith(
      'auth_refresh_tokens',
      expect.objectContaining({
        referencedTableName: 'wp_users',
        referencedColumnNames: ['ID'],
        columnNames: ['user_id']
      })
    );

    const indexes = queryRunner.createIndex.mock.calls.map(([, index]) => index);
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'idx_auth_refresh_tokens_family_active', columnNames: ['family_id', 'revoked_at'] }),
      expect.objectContaining({ name: 'idx_auth_refresh_tokens_user_active', columnNames: ['user_id', 'revoked_at'] }),
      expect.objectContaining({ name: 'idx_auth_refresh_tokens_expiry', columnNames: ['expires_at'] })
    ]));
  });
});