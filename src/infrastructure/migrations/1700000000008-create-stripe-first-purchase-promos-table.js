const { Table } = require('typeorm');

class CreateStripeFirstPurchasePromosTable1700000000008 {
  name = 'CreateStripeFirstPurchasePromosTable1700000000008';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable('stripe_first_purchase_promos'))) {
      await queryRunner.createTable(new Table({
        name: 'stripe_first_purchase_promos',
        columns: [
          { name: 'term_months', type: 'tinyint', unsigned: true, isPrimary: true },
          { name: 'promotion_code_id', type: 'varchar', length: '64', isNullable: false },
          { name: 'coupon_id', type: 'varchar', length: '64', isNullable: true },
          { name: 'created_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP' },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }

    if (!(await queryRunner.hasTable('stripe_first_purchase_promo_metrics'))) {
      await queryRunner.createTable(new Table({
        name: 'stripe_first_purchase_promo_metrics',
        columns: [
          { name: 'metric_key', type: 'varchar', length: '64', isPrimary: true },
          { name: 'metric_value', type: 'bigint', unsigned: true, isNullable: false, default: 0 },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable('stripe_first_purchase_promo_metrics')) {
      await queryRunner.dropTable('stripe_first_purchase_promo_metrics');
    }

    if (await queryRunner.hasTable('stripe_first_purchase_promos')) {
      await queryRunner.dropTable('stripe_first_purchase_promos');
    }
  }
}

module.exports = {
  CreateStripeFirstPurchasePromosTable1700000000008
};
