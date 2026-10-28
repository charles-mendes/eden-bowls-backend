const { Table } = require('typeorm');
const { TERM_PERCENT_MAP, VALID_SUBSCRIPTION_TERMS } = require('../../core/first-purchase-discount');

const TABLE = 'first_purchase_term_discounts';

// First-invoice discount percent per Stripe account and term (first-purchase-discount), apart from the coupon
// mapping, since the checkout needs the percent of a term with no coupon mapped. Seeded with the percents of
// before the table, in both accounts; a seeded row already present is kept.
class CreateFirstPurchaseTermDiscounts1700000000046 {
  name = 'CreateFirstPurchaseTermDiscounts1700000000046';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(TABLE))) {
      await queryRunner.createTable(new Table({
        name: TABLE,
        columns: [
          { name: 'stripe_account', type: 'varchar', length: '8', isPrimary: true },
          { name: 'term_months', type: 'tinyint', unsigned: true, isPrimary: true },
          { name: 'discount_percent', type: 'tinyint', unsigned: true, isNullable: false },
          { name: 'updated_by', type: 'bigint', unsigned: true, isNullable: true },
          { name: 'updated_at', type: 'datetime', isNullable: false, default: 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' }
        ]
      }), true);
    }
    for (const account of ['br', 'us']) {
      for (const term of VALID_SUBSCRIPTION_TERMS) {
        await queryRunner.query(
          `INSERT IGNORE INTO \`${TABLE}\` (stripe_account, term_months, discount_percent) VALUES (?, ?, ?)`,
          [account, term, TERM_PERCENT_MAP[term]]
        );
      }
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(TABLE)) {
      await queryRunner.dropTable(TABLE);
    }
  }
}

module.exports = {
  CreateFirstPurchaseTermDiscounts1700000000046
};
