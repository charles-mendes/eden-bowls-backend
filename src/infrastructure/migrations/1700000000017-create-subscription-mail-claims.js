const { Table, TableIndex } = require('typeorm');

class CreateSubscriptionMailClaims1700000000017 {
  name = 'CreateSubscriptionMailClaims1700000000017';

  async up(queryRunner) {
    if (await queryRunner.hasTable('subscription_mail_claims')) {
      return;
    }

    await queryRunner.createTable(new Table({
      name: 'subscription_mail_claims',
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
          name: 'stripe_subscription_id',
          type: 'varchar',
          length: '64',
          isNullable: false
        },
        {
          name: 'template',
          type: 'varchar',
          length: '64',
          isNullable: false
        },
        {
          name: 'reference_id',
          type: 'varchar',
          length: '191',
          isNullable: false
        },
        {
          name: 'claimed_at',
          type: 'datetime',
          isNullable: false,
          default: 'CURRENT_TIMESTAMP'
        },
        {
          name: 'sent_at',
          type: 'datetime',
          isNullable: true
        }
      ]
    }), true);

    await queryRunner.createIndex('subscription_mail_claims', new TableIndex({
      name: 'uniq_subscription_mail_claim',
      columnNames: ['stripe_subscription_id', 'template', 'reference_id'],
      isUnique: true
    }));
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('subscription_mail_claims')) {
      await queryRunner.dropTable('subscription_mail_claims');
    }
  }
}

module.exports = {
  CreateSubscriptionMailClaims1700000000017
};
