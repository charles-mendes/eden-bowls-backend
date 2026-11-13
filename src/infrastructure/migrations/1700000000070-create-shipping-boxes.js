const BOXES = 'shipping_us_boxes';
const PACKAGES = 'ups_shipment_packages';
const US_SETTINGS = 'shipping_us_settings';

// The client's two boxes (shipping-boxes). `max_packs` counts packs of any size.
const SEED_BOXES = [
  ['starter', 'Starter Box', 14, 12, 8, 1.0, 10],
  ['monthly', 'Caixa mensal', 18, 14, 12, 1.5, 30]
];

// Boxes of the box plan, and one row per UPS package of a label (shipping-boxes). The checkout quote
// package moves to the monthly box at full weight only while it still holds the old defaults.
class CreateShippingBoxes1700000000070 {
  name = 'CreateShippingBoxes1700000000070';

  async up(queryRunner) {
    if (!(await queryRunner.hasTable(BOXES))) {
      await queryRunner.query(
        `CREATE TABLE ${BOXES} (
          \`key\` VARCHAR(16) NOT NULL PRIMARY KEY,
          label VARCHAR(64) NOT NULL,
          length_in DECIMAL(10,2) NOT NULL,
          width_in DECIMAL(10,2) NOT NULL,
          height_in DECIMAL(10,2) NOT NULL,
          empty_weight_kg DECIMAL(5,2) NOT NULL,
          max_packs INT UNSIGNED NOT NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
      for (const row of SEED_BOXES) {
        await queryRunner.query(
          `INSERT INTO ${BOXES} (\`key\`, label, length_in, width_in, height_in, empty_weight_kg, max_packs) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          row
        );
      }
      if (await queryRunner.hasTable(US_SETTINGS)) {
        await queryRunner.query(
          `UPDATE \`${US_SETTINGS}\` SET package_length_in = 18, package_width_in = 14, package_height_in = 12, package_weight_lb = 37.5
           WHERE package_length_in = 12 AND package_width_in = 12 AND package_height_in = 12 AND package_weight_lb = 10`
        );
      }
    }
    if (!(await queryRunner.hasTable(PACKAGES))) {
      await queryRunner.query(
        `CREATE TABLE ${PACKAGES} (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          shipment_id BIGINT UNSIGNED NOT NULL,
          sequence INT UNSIGNED NOT NULL,
          box_key VARCHAR(16) NULL,
          pack_count INT UNSIGNED NOT NULL DEFAULT 0,
          weight_lb DECIMAL(10,1) NOT NULL,
          dry_ice_kg DECIMAL(3,1) NULL,
          tracking_number VARCHAR(191) NULL,
          label_path VARCHAR(512) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE KEY uq_ups_shipment_packages_sequence (shipment_id, sequence),
          CONSTRAINT fk_ups_shipment_packages_shipment FOREIGN KEY (shipment_id) REFERENCES ups_shipments (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
      );
    }
  }

  async down(queryRunner) {
    if (await queryRunner.hasTable(PACKAGES)) {
      await queryRunner.query(`DROP TABLE ${PACKAGES}`);
    }
    if (await queryRunner.hasTable(BOXES)) {
      await queryRunner.query(`DROP TABLE ${BOXES}`);
    }
  }
}

module.exports = { CreateShippingBoxes1700000000070, SEED_BOXES };
