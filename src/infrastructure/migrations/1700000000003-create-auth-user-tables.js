const { Table, TableIndex } = require('typeorm');

class CreateAuthUserTables1700000000003 {
  name = 'CreateAuthUserTables1700000000003';

  async up(queryRunner) {
    await this.createUsersTable(queryRunner);
    await this.createUserMetaTable(queryRunner);
    await this.seedUsers(queryRunner);
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('wp_usermeta')) {
      await queryRunner.dropTable('wp_usermeta');
    }

    if (await queryRunner.hasTable('wp_users')) {
      await queryRunner.dropTable('wp_users');
    }
  }

  async createUsersTable(queryRunner) {
    if (await queryRunner.hasTable('wp_users')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_users',
      columns: [
        {
          name: 'ID',
          type: 'bigint',
          unsigned: true,
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment'
        },
        {
          name: 'user_login',
          type: 'varchar',
          length: '60',
          isNullable: false
        },
        {
          name: 'user_pass',
          type: 'varchar',
          length: '255',
          isNullable: false
        },
        {
          name: 'user_nicename',
          type: 'varchar',
          length: '50',
          isNullable: false
        },
        {
          name: 'user_email',
          type: 'varchar',
          length: '100',
          isNullable: false
        },
        {
          name: 'display_name',
          type: 'varchar',
          length: '250',
          isNullable: false,
          default: "''"
        },
        {
          name: 'created_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP'
        },
        {
          name: 'updated_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP',
          onUpdate: 'CURRENT_TIMESTAMP'
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_users', new TableIndex({
      name: 'uk_wp_users_login',
      columnNames: ['user_login'],
      isUnique: true
    }));

    await queryRunner.createIndex('wp_users', new TableIndex({
      name: 'uk_wp_users_email',
      columnNames: ['user_email'],
      isUnique: true
    }));
  }

  async createUserMetaTable(queryRunner) {
    if (await queryRunner.hasTable('wp_usermeta')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'wp_usermeta',
      columns: [
        {
          name: 'umeta_id',
          type: 'bigint',
          unsigned: true,
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment'
        },
        {
          name: 'user_id',
          type: 'bigint',
          unsigned: true,
          isNullable: false
        },
        {
          name: 'meta_key',
          type: 'varchar',
          length: '255',
          isNullable: true
        },
        {
          name: 'meta_value',
          type: 'longtext',
          isNullable: true
        }
      ]
    }), true);

    await queryRunner.createIndex('wp_usermeta', new TableIndex({
      name: 'idx_wp_usermeta_user_id',
      columnNames: ['user_id']
    }));

    await queryRunner.createIndex('wp_usermeta', new TableIndex({
      name: 'idx_wp_usermeta_meta_key',
      columnNames: ['meta_key']
    }));
  }

  async seedUsers(queryRunner) {
    await queryRunner.query(
      "INSERT IGNORE INTO `wp_users` (`ID`, `user_login`, `user_pass`, `user_nicename`, `user_email`, `display_name`) VALUES " +
      "(1, 'demo', MD5('demo123'), 'demo', 'demo@example.com', 'Demo User'), " +
      "(2, 'pending', MD5('demo123'), 'pending', 'pending@example.com', 'Pending User')"
    );

    await queryRunner.query(
      "INSERT IGNORE INTO `wp_usermeta` (`user_id`, `meta_key`, `meta_value`) VALUES " +
      "(1, 'hsr_activation_status', 'active')," +
      "(2, 'hsr_activation_status', 'pending')"
    );
  }
}

module.exports = {
  CreateAuthUserTables1700000000003
};
