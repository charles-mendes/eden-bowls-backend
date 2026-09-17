const { Table, TableIndex } = require('typeorm');

class CreateAdminAuditEvents1700000000016 {
  name = 'CreateAdminAuditEvents1700000000016';

  async up(queryRunner) {
    if (await queryRunner.hasTable('admin_audit_events')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'admin_audit_events',
      columns: [
        {
          name: 'id',
          type: 'bigint',
          unsigned: true,
          isPrimary: true,
          isGenerated: true,
          generationStrategy: 'increment'
        },
        {
          name: 'actor_user_id',
          type: 'bigint',
          unsigned: true,
          isNullable: true
        },
        {
          name: 'actor_email',
          type: 'varchar',
          length: '191',
          isNullable: true
        },
        {
          name: 'action',
          type: 'varchar',
          length: '64',
          isNullable: false
        },
        {
          name: 'target_user_id',
          type: 'bigint',
          unsigned: true,
          isNullable: true
        },
        {
          name: 'target_email',
          type: 'varchar',
          length: '191',
          isNullable: true
        },
        {
          name: 'metadata',
          type: 'json',
          isNullable: true
        },
        {
          name: 'created_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP'
        }
      ]
    }), true);

    await queryRunner.createIndex('admin_audit_events', new TableIndex({
      name: 'idx_admin_audit_target_created',
      columnNames: ['target_user_id', 'created_at']
    }));

    await queryRunner.createIndex('admin_audit_events', new TableIndex({
      name: 'idx_admin_audit_actor_created',
      columnNames: ['actor_user_id', 'created_at']
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('admin_audit_events')) {
      await queryRunner.dropTable('admin_audit_events');
    }
  }
}

module.exports = {
  CreateAdminAuditEvents1700000000016
};
