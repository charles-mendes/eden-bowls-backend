const TABLE = 'shipping_us_settings';

// Whether the UPS test environment (CIE) gets the US quotes and labels without the dry ice declaration. CIE drops
// UPS Ground for a package with dry ice; production UPS rates it. Off on deploy, and never read by production UPS.
class AddUsSkipDryIceInTest1700000000088 {
  name = 'AddUsSkipDryIceInTest1700000000088';

  async up(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && !(await queryRunner.hasColumn(TABLE, 'skip_dry_ice_in_test'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`skip_dry_ice_in_test\` TINYINT(1) NOT NULL DEFAULT 0`);
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'skip_dry_ice_in_test'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`skip_dry_ice_in_test\``);
    }
  }
}

module.exports = {
  AddUsSkipDryIceInTest1700000000088
};
