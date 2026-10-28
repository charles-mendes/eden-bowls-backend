const { CreateShippingSettingsTables1700000000010 } = require('../src/infrastructure/migrations/1700000000010-create-shipping-settings-tables');
const { AddUsMaxTransitDays1700000000047 } = require('../src/infrastructure/migrations/1700000000047-add-us-max-transit-days');

describe('CreateShippingSettingsTables1700000000010', () => {
  test('creates BR and US shipping settings tables and seeds defaults', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue(undefined)
    };

    await new CreateShippingSettingsTables1700000000010().up(queryRunner);

    const createdTables = queryRunner.createTable.mock.calls.map(([table]) => table);
    expect(createdTables.map((table) => table.name)).toEqual([
      'shipping_br_settings',
      'shipping_us_settings'
    ]);
    expect(createdTables[0].columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'center_lat',
      'center_lng',
      'per_km',
      'road_factor',
      'max_distance_km'
    ]));
    expect(createdTables[1].columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'cost',
      'label',
      'carrier',
      'delivery'
    ]));
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `shipping_br_settings`'),
      expect.arrayContaining([-25.44839, -49.21741, 0.95])
    );
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO `shipping_us_settings`'),
      [12.9, 'FedEx 3–5 business days', 'FedEx', '3–5 business days']
    );
  });
});

describe('AddUsMaxTransitDays1700000000047', () => {
  function runner({ hasColumn }) {
    return {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(hasColumn),
      query: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('adds max_transit_days with 1 as the value after deploy, once', async () => {
    const first = runner({ hasColumn: false });
    await new AddUsMaxTransitDays1700000000047().up(first);
    expect(first.query).toHaveBeenCalledWith('ALTER TABLE `shipping_us_settings` ADD COLUMN `max_transit_days` INT NOT NULL DEFAULT 1');

    const again = runner({ hasColumn: true });
    await new AddUsMaxTransitDays1700000000047().up(again);
    expect(again.query).not.toHaveBeenCalled();
  });

  test('down drops the column', async () => {
    const queryRunner = runner({ hasColumn: true });
    await new AddUsMaxTransitDays1700000000047().down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith('ALTER TABLE `shipping_us_settings` DROP COLUMN `max_transit_days`');
  });
});
