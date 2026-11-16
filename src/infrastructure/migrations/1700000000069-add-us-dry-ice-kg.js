const TABLE = 'shipping_us_settings';

// Dry ice in each US box, in kilograms (ups-dry-ice). UPS needs it declared on labels and quotes as UN1845.
class AddUsDryIceKg1700000000069 {
  name = 'AddUsDryIceKg1700000000069';

  async up(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && !(await queryRunner.hasColumn(TABLE, 'package_dry_ice_kg'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` ADD COLUMN \`package_dry_ice_kg\` DECIMAL(3,1) NOT NULL DEFAULT 0.5`);
    }
  }

  async down(queryRunner) {
    if ((await queryRunner.hasTable(TABLE)) && (await queryRunner.hasColumn(TABLE, 'package_dry_ice_kg'))) {
      await queryRunner.query(`ALTER TABLE \`${TABLE}\` DROP COLUMN \`package_dry_ice_kg\``);
    }
  }
}

module.exports = {
  AddUsDryIceKg1700000000069
};
