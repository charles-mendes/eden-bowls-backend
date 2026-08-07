const { HttpError } = require('../../core/http-error');

class PriceZonePolicyRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'price_zone_policy';
  }

  async findActiveZoneId(country, currency) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }

    const sql = [
      'SELECT zone_id',
      `FROM \`${this.tableName}\``,
      'WHERE is_active = 1',
      'AND country_code = ?',
      'AND currency_code = ?',
      'LIMIT 1'
    ].join(' ');

    const rows = await this.dataSource.query(sql, [
      String(country || '').trim().toUpperCase(),
      String(currency || '').trim().toUpperCase()
    ]);

    if (!Array.isArray(rows) || rows.length === 0) {
      return null;
    }

    const zoneId = String(rows[0].zone_id || '').trim();
    return zoneId || null;
  }
}

module.exports = {
  PriceZonePolicyRepository
};
