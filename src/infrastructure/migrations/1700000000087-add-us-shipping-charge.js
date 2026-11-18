const TABLE = 'shipping_us_settings';

// Whether US customers pay shipping (customer-shipping-charge). Off on deploy: the company pays UPS and the quote is
// kept as its cost. Changed in the admin by an operator with shipping.write on the US market.
class AddUsShippingCharge1700000000087 {
  name = 'AddUsShippingCharge1700000000087';

  async up(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && !(await queryRunner.hasColumn(TABLE, 'charge_shipping'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`charge_shipping\` TINYINT(1) NOT NULL DEFAULT 0`);
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'charge_shipping'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`charge_shipping\``);
    }
  }
}

module.exports = {
  AddUsShippingCharge1700000000087
};
