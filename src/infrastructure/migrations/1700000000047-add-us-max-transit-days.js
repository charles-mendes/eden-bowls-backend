const TABLE = 'shipping_us_settings';

// US maximum UPS transit days (shipping-settings), editable in the admin in place of a fixed limit of 1.
class AddUsMaxTransitDays1700000000047 {
  name = 'AddUsMaxTransitDays1700000000047';

  async up(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && !(await queryRunner.hasColumn(TABLE, 'max_transit_days'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`max_transit_days\` INT NOT NULL DEFAULT 1`);
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'max_transit_days'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`max_transit_days\``);
    }
  }
}

module.exports = {
  AddUsMaxTransitDays1700000000047
};
