const { Table, TableIndex } = require('typeorm');

class CreatePrivacyTables1700000000015 {
  name = 'CreatePrivacyTables1700000000015';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('privacy_consents'))) {
      await queryRunner.createTable(new Table({
        name: 'privacy_consents',
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
            name: 'user_id',
            type: 'bigint',
            unsigned: true,
            isNullable: true
          },
          {
            name: 'consent_type',
            type: 'varchar',
            length: '32',
            isNullable: false
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            isNullable: false
          },
          {
            name: 'document_version',
            type: 'varchar',
            length: '32',
            isNullable: true
          },
          {
            name: 'source',
            type: 'varchar',
            length: '32',
            isNullable: false
          },
          {
            name: 'ip_hash',
            type: 'varchar',
            length: '64',
            isNullable: true
          },
          {
            name: 'user_agent',
            type: 'varchar',
            length: '255',
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

      await queryRunner.createIndex('privacy_consents', new TableIndex({
        name: 'idx_privacy_consents_user_type_created',
        columnNames: ['user_id', 'consent_type', 'created_at']
      }));
    }

    if (!(await queryRunner.hasTable('privacy_requests'))) {
      await queryRunner.createTable(new Table({
        name: 'privacy_requests',
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
            name: 'user_id',
            type: 'bigint',
            unsigned: true,
            isNullable: true
          },
          {
            name: 'type',
            type: 'varchar',
            length: '32',
            isNullable: false
          },
          {
            name: 'status',
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'open'"
          },
          {
            name: 'locale',
            type: 'varchar',
            length: '16',
            isNullable: true
          },
          {
            name: 'market',
            type: 'varchar',
            length: '8',
            isNullable: false,
            default: "'US'"
          },
          {
            name: 'payload',
            type: 'json',
            isNullable: true
          },
          {
            name: 'result_note',
            type: 'text',
            isNullable: true
          },
          {
            name: 'due_at',
            type: 'datetime',
            isNullable: true
          },
          {
            name: 'extended_at',
            type: 'datetime',
            isNullable: true
          },
          {
            name: 'extension_reason',
            type: 'varchar',
            length: '255',
            isNullable: true
          },
          {
            name: 'identity_status',
            type: 'varchar',
            length: '32',
            isNullable: false,
            default: "'unverified'"
          },
          {
            name: 'identity_verified_at',
            type: 'datetime',
            isNullable: true
          },
          {
            name: 'channel',
            type: 'varchar',
            length: '16',
            isNullable: false,
            default: "'in_app'"
          },
          {
            name: 'resolved_at',
            type: 'datetime',
            isNullable: true
          },
          {
            name: 'resolved_by',
            type: 'bigint',
            unsigned: true,
            isNullable: true
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

      await queryRunner.createIndex('privacy_requests', new TableIndex({
        name: 'idx_privacy_requests_user_created',
        columnNames: ['user_id', 'created_at']
      }));
      await queryRunner.createIndex('privacy_requests', new TableIndex({
        name: 'idx_privacy_requests_status_due',
        columnNames: ['status', 'due_at']
      }));
      await queryRunner.createIndex('privacy_requests', new TableIndex({
        name: 'idx_privacy_requests_identity',
        columnNames: ['identity_status']
      }));
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('privacy_requests')) {
      await queryRunner.dropTable('privacy_requests');
    }
    if (await queryRunner.hasTable('privacy_consents')) {
      await queryRunner.dropTable('privacy_consents');
    }
  }
}

module.exports = {
  CreatePrivacyTables1700000000015
};
