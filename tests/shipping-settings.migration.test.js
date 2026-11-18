const { CreateShippingSettingsTables1700000000010 } = require('../src/infrastructure/migrations/1700000000010-create-shipping-settings-tables');
const { AddUsMaxTransitDays1700000000047 } = require('../src/infrastructure/migrations/1700000000047-add-us-max-transit-days');
const { AddUsDryIceKg1700000000069 } = require('../src/infrastructure/migrations/1700000000069-add-us-dry-ice-kg');
const { AddBrDeliveryDays1700000000080 } = require('../src/infrastructure/migrations/1700000000080-add-br-delivery-days');
const { AddUsShippingCharge1700000000087 } = require('../src/infrastructure/migrations/1700000000087-add-us-shipping-charge');

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

describe('AddUsDryIceKg1700000000069', () => {
  function runner({ hasColumn }) {
    return {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(hasColumn),
      query: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('adds package_dry_ice_kg with 0.5 as the value after deploy, once', async () => {
    const first = runner({ hasColumn: false });
    await new AddUsDryIceKg1700000000069().up(first);
    expect(first.query).toHaveBeenCalledWith('ALTER TABLE `shipping_us_settings` ADD COLUMN `package_dry_ice_kg` DECIMAL(3,1) NOT NULL DEFAULT 0.5');

    const again = runner({ hasColumn: true });
    await new AddUsDryIceKg1700000000069().up(again);
    expect(again.query).not.toHaveBeenCalled();
  });

  test('down drops the column', async () => {
    const queryRunner = runner({ hasColumn: true });
    await new AddUsDryIceKg1700000000069().down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith('ALTER TABLE `shipping_us_settings` DROP COLUMN `package_dry_ice_kg`');
  });
});

describe('AddBrDeliveryDays1700000000080', () => {
  function runner({ hasColumn }) {
    return {
      hasTable: jest.fn().mockResolvedValue(true),
      hasColumn: jest.fn().mockResolvedValue(hasColumn),
      query: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('adds delivery_days with 0 (same day, the rule before it) as the value after deploy, once', async () => {
    const first = runner({ hasColumn: false });
    await new AddBrDeliveryDays1700000000080().up(first);
    expect(first.query).toHaveBeenCalledWith('ALTER TABLE `shipping_br_settings` ADD COLUMN `delivery_days` INT NOT NULL DEFAULT 0');

    const again = runner({ hasColumn: true });
    await new AddBrDeliveryDays1700000000080().up(again);
    expect(again.query).not.toHaveBeenCalled();
  });

  test('down drops the column', async () => {
    const queryRunner = runner({ hasColumn: true });
    await new AddBrDeliveryDays1700000000080().down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith('ALTER TABLE `shipping_br_settings` DROP COLUMN `delivery_days`');
  });
});

describe('AddUsShippingCharge1700000000087', () => {
  function runner({ hasTable = true, hasColumn = false } = {}) {
    return {
      hasTable: jest.fn().mockResolvedValue(hasTable),
      hasColumn: jest.fn().mockResolvedValue(hasColumn),
      query: jest.fn().mockResolvedValue(undefined)
    };
  }

  test('Value after deploy: adds charge_shipping off, once', async () => {
    const first = runner({ hasColumn: false });
    await new AddUsShippingCharge1700000000087().up(first);
    expect(first.query).toHaveBeenCalledWith('ALTER TABLE `shipping_us_settings` ADD COLUMN `charge_shipping` TINYINT(1) NOT NULL DEFAULT 0');

    const again = runner({ hasColumn: true });
    await new AddUsShippingCharge1700000000087().up(again);
    expect(again.query).not.toHaveBeenCalled();
  });

  test('down drops the column', async () => {
    const queryRunner = runner({ hasColumn: true });
    await new AddUsShippingCharge1700000000087().down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith('ALTER TABLE `shipping_us_settings` DROP COLUMN `charge_shipping`');
  });

  test('is registered last', () => {
    const { buildDataSourceOptions } = require('../src/infrastructure/db');
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names[names.length - 1]).toBe('AddUsShippingCharge1700000000087');
  });
});
