const { HttpError } = require('../../core/http-error');
const {
  brToParams,
  loadShippingSettings,
  nextSettings,
  settingsFromRows,
  usToParams
} = require('../shipping/shipping-settings');

const BR_COLUMNS = [
  'enabled',
  'label',
  'center_name',
  'center_street',
  'center_city',
  'center_state',
  'center_zipcode',
  'center_lat',
  'center_lng',
  'center_version',
  'per_km',
  'road_factor',
  'min_fee',
  'max_fee',
  'max_distance_km',
  'km_per_day',
  'min_days',
  'max_days'
];

const US_COLUMNS = ['enabled', 'cost', 'label', 'carrier', 'delivery'];

class ShippingSettingsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.brTableName = options.brTableName || 'shipping_br_settings';
    this.usTableName = options.usTableName || 'shipping_us_settings';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async get() {
    this.ensureDataSource();

    const [brRows, usRows] = await Promise.all([
      this.dataSource.query(`SELECT * FROM \`${this.brTableName}\` WHERE \`id\` = 1 LIMIT 1`),
      this.dataSource.query(`SELECT * FROM \`${this.usTableName}\` WHERE \`id\` = 1 LIMIT 1`)
    ]);

    const brRow = Array.isArray(brRows) ? brRows[0] : null;
    const usRow = Array.isArray(usRows) ? usRows[0] : null;

    if (!brRow && !usRow) {
      return loadShippingSettings();
    }

    return settingsFromRows(brRow, usRow);
  }

  async save(payload = {}) {
    this.ensureDataSource();

    const current = await this.get();
    const next = nextSettings(current, payload);

    await Promise.all([
      this.dataSource.query(
        [
          `INSERT INTO \`${this.brTableName}\` (\`id\`, ${BR_COLUMNS.map((column) => `\`${column}\``).join(', ')})`,
          `VALUES (1, ${BR_COLUMNS.map(() => '?').join(', ')})`,
          `ON DUPLICATE KEY UPDATE ${BR_COLUMNS.map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(', ')}`
        ].join(' '),
        brToParams(next.br)
      ),
      this.dataSource.query(
        [
          `INSERT INTO \`${this.usTableName}\` (\`id\`, ${US_COLUMNS.map((column) => `\`${column}\``).join(', ')})`,
          `VALUES (1, ${US_COLUMNS.map(() => '?').join(', ')})`,
          `ON DUPLICATE KEY UPDATE ${US_COLUMNS.map((column) => `\`${column}\` = VALUES(\`${column}\`)`).join(', ')}`
        ].join(' '),
        usToParams(next.us)
      )
    ]);

    return next;
  }
}

module.exports = {
  ShippingSettingsRepository
};
