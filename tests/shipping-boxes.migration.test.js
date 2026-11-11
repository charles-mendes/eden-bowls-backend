const { CreateShippingBoxes1700000000070 } = require('../src/infrastructure/migrations/1700000000070-create-shipping-boxes');

function runner({ tables = [] } = {}) {
  return {
    hasTable: jest.fn(async (name) => name === 'shipping_us_settings' || name === 'ups_shipments' || tables.includes(name)),
    query: jest.fn().mockResolvedValue(undefined)
  };
}

const statements = (queryRunner) => queryRunner.query.mock.calls.map(([sql]) => sql);

describe('CreateShippingBoxes1700000000070', () => {
  test('creates both tables with the exact columns and keys', async () => {
    const queryRunner = runner();
    await new CreateShippingBoxes1700000000070().up(queryRunner);
    const [boxes] = statements(queryRunner);
    const packages = statements(queryRunner).find((sql) => sql.includes('CREATE TABLE ups_shipment_packages'));

    expect(boxes.replace(/\s+/g, ' ')).toContain('CREATE TABLE shipping_us_boxes ( `key` VARCHAR(16) NOT NULL PRIMARY KEY, label VARCHAR(64) NOT NULL, length_in DECIMAL(10,2) NOT NULL, width_in DECIMAL(10,2) NOT NULL, height_in DECIMAL(10,2) NOT NULL, empty_weight_kg DECIMAL(5,2) NOT NULL, max_packs INT UNSIGNED NOT NULL,');
    expect(packages.replace(/\s+/g, ' ')).toContain('shipment_id BIGINT UNSIGNED NOT NULL, sequence INT UNSIGNED NOT NULL, box_key VARCHAR(16) NULL, pack_count INT UNSIGNED NOT NULL DEFAULT 0, weight_lb DECIMAL(10,1) NOT NULL, dry_ice_kg DECIMAL(3,1) NULL, tracking_number VARCHAR(191) NULL, label_path VARCHAR(512) NULL,');
    expect(packages).toContain('UNIQUE KEY uq_ups_shipment_packages_sequence (shipment_id, sequence)');
    expect(packages).toContain('FOREIGN KEY (shipment_id) REFERENCES ups_shipments (id)');
  });

  test('seeds the client boxes', async () => {
    const queryRunner = runner();
    await new CreateShippingBoxes1700000000070().up(queryRunner);
    const seeds = queryRunner.query.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO shipping_us_boxes')).map(([, params]) => params);

    expect(seeds).toEqual([
      ['starter', 'Starter Box', 14, 12, 8, 1.0, 10],
      ['monthly', 'Caixa mensal', 18, 14, 12, 1.5, 30]
    ]);
  });

  test('Package at the old values: only a 12 × 12 × 12 in, 10 lb package becomes the monthly box at 37.5 lb', async () => {
    const queryRunner = runner();
    await new CreateShippingBoxes1700000000070().up(queryRunner);
    const update = statements(queryRunner).find((sql) => sql.startsWith('UPDATE')).replace(/\s+/g, ' ');

    expect(update).toBe('UPDATE `shipping_us_settings` SET package_length_in = 18, package_width_in = 14, package_height_in = 12, package_weight_lb = 37.5 WHERE package_length_in = 12 AND package_width_in = 12 AND package_height_in = 12 AND package_weight_lb = 10');
    expect(update).not.toContain('dry_ice');
  });

  test('Package edited before: the WHERE keeps a 25 lb package as it is', async () => {
    const queryRunner = runner();
    await new CreateShippingBoxes1700000000070().up(queryRunner);
    const update = statements(queryRunner).find((sql) => sql.startsWith('UPDATE'));

    expect(update).toContain('package_weight_lb = 10');
  });

  test('a second run does nothing', async () => {
    const queryRunner = runner({ tables: ['shipping_us_boxes', 'ups_shipment_packages'] });
    await new CreateShippingBoxes1700000000070().up(queryRunner);

    expect(queryRunner.query).not.toHaveBeenCalled();
  });

  test('down drops both tables and leaves the package as it is', async () => {
    const queryRunner = runner({ tables: ['shipping_us_boxes', 'ups_shipment_packages'] });
    await new CreateShippingBoxes1700000000070().down(queryRunner);

    expect(statements(queryRunner)).toEqual(['DROP TABLE ups_shipment_packages', 'DROP TABLE shipping_us_boxes']);
  });
});
