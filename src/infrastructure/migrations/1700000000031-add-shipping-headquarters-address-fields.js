const BR_TABLE = 'shipping_br_settings';
const US_TABLE = 'shipping_us_settings';

const BR_COLUMNS = [
  ['center_number', "VARCHAR(32) NOT NULL DEFAULT ''"],
  ['center_complement', "VARCHAR(128) NOT NULL DEFAULT ''"],
  ['center_neighborhood', "VARCHAR(128) NOT NULL DEFAULT ''"]
];

const US_COLUMNS = [
  ['ship_from_street2', "VARCHAR(191) NOT NULL DEFAULT ''"]
];

// Brazil delivers inside a 50 km radius of the headquarters. 500 was the old seed and never a real rule.
const BR_RADIUS_KM = 50;
const OLD_SEED_RADIUS_KM = 500;

async function addColumns(queryRunner, table, columns) {
  for (const [name, definition] of columns) {
    if (!(await queryRunner.hasColumn(table, name))) {
      await queryRunner.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${name}\` ${definition}`);
    }
  }
}

async function dropColumns(queryRunner, table, columns) {
  for (const [name] of columns) {
    if (await queryRunner.hasColumn(table, name)) {
      await queryRunner.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${name}\``);
    }
  }
}

class AddShippingHeadquartersAddressFields1700000000031 {
  name = 'AddShippingHeadquartersAddressFields1700000000031';

  async up(queryRunner) {
    if (await queryRunner.hasTable(BR_TABLE)) {
      await addColumns(queryRunner, BR_TABLE, BR_COLUMNS);
      await queryRunner.query(
        `UPDATE \`${BR_TABLE}\` SET \`max_distance_km\` = ? WHERE \`max_distance_km\` = ?`,
        [BR_RADIUS_KM, OLD_SEED_RADIUS_KM]
      );
    }
    if (await queryRunner.hasTable(US_TABLE)) {
      await addColumns(queryRunner, US_TABLE, US_COLUMNS);
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(BR_TABLE)) {
      await dropColumns(queryRunner, BR_TABLE, BR_COLUMNS);
    }
    if (await queryRunner.hasTable(US_TABLE)) {
      await dropColumns(queryRunner, US_TABLE, US_COLUMNS);
    }
  }
}

module.exports = {
  AddShippingHeadquartersAddressFields1700000000031
};
