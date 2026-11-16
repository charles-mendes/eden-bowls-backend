const TABLE = 'shipping_br_settings';

// Brazil delivery time (shipping-settings): business days from preparation to delivery, picked in the admin.
// 0 keeps the same-day delivery every Brazil date was calculated with before this column.
class AddBrDeliveryDays1700000000080 {
  name = 'AddBrDeliveryDays1700000000080';

  async up(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && !(await queryRunner.hasColumn(TABLE, 'delivery_days'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`delivery_days\` INT NOT NULL DEFAULT 0`);
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'delivery_days'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`delivery_days\``);
    }
  }
}

module.exports = {
  AddBrDeliveryDays1700000000080
};
