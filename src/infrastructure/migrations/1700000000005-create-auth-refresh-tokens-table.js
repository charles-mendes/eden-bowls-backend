const { Table, TableForeignKey, TableIndex } = require('typeorm');

class CreateAuthRefreshTokensTable1700000000005 {
  name = 'CreateAuthRefreshTokensTable1700000000005';

  async up(queryRunner) {
    if (await queryRunner.hasTable('auth_refresh_tokens')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'auth_refresh_tokens',
      columns: [
        { name: 'id', type: 'varchar', length: '36', isPrimary: true },
        { name: 'user_id', type: 'bigint', unsigned: true, isNullable: false },
        { name: 'family_id', type: 'varchar', length: '36', isNullable: false },
        { name: 'token_hash', type: 'char', length: '64', isNullable: false, isUnique: true },
        { name: 'replaced_by_id', type: 'varchar', length: '36', isNullable: true },
        { name: 'replay_grace_until', type: 'datetime', isNullable: true },
        { name: 'replay_consumed_at', type: 'datetime', isNullable: true },
        { name: 'expires_at', type: 'datetime', isNullable: false },
        { name: 'last_used_at', type: 'datetime', isNullable: true },
        { name: 'revoked_at', type: 'datetime', isNullable: true },
        { name: 'revoked_reason', type: 'varchar', length: '64', isNullable: true },
        { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
        { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
      ]
    }), true);

    await queryRunner.createForeignKey('auth_refresh_tokens', new TableForeignKey({
      name: 'fk_auth_refresh_tokens_user_id',
      columnNames: ['user_id'],
      referencedTableName: 'wp_users',
      referencedColumnNames: ['ID'],
      onDelete: 'CASCADE'
    }));

    await queryRunner.createIndex('auth_refresh_tokens', new TableIndex({
      name: 'idx_auth_refresh_tokens_family_active',
      columnNames: ['family_id', 'revoked_at']
    }));

    await queryRunner.createIndex('auth_refresh_tokens', new TableIndex({
      name: 'idx_auth_refresh_tokens_user_active',
      columnNames: ['user_id', 'revoked_at']
    }));

    await queryRunner.createIndex('auth_refresh_tokens', new TableIndex({
      name: 'idx_auth_refresh_tokens_expiry',
      columnNames: ['expires_at']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('auth_refresh_tokens')) {
      await queryRunner.dropTable('auth_refresh_tokens');
    }
  }
}

module.exports = {
  CreateAuthRefreshTokensTable1700000000005
};