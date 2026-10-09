const { HttpError } = require('../../core/http-error');

const RUNS_KEPT_PER_MARKET = 50;

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146 || /doesn't exist/i.test(message)));
}

function toIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseSummary(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
}

class CatalogSyncRunsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'catalog_sync_runs';
    this.keepPerMarket = Number(options.keepPerMarket || RUNS_KEPT_PER_MARKET);
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // Stores one run and drops runs of the same market beyond the newest `keepPerMarket`.
  async insert(run) {
    this.ensureDataSource();
    const market = String(run.market || '').toUpperCase();
    const result = await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (\`market\`, \`currency\`, \`scope\`, \`product_id\`, \`status\`, \`summary\`, \`error\`, \`started_at\`, \`finished_at\`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        market,
        run.currency ? String(run.currency).toUpperCase() : null,
        String(run.scope || 'market'),
        run.productId ? String(run.productId) : null,
        String(run.status),
        run.summary ? JSON.stringify(run.summary) : null,
        run.error ? String(run.error).slice(0, 500) : null,
        new Date(run.startedAt),
        new Date(run.finishedAt)
      ]
    );
    await this.dataSource.query(
      [
        `DELETE FROM \`${this.tableName}\` WHERE \`market\` = ? AND \`id\` NOT IN (`,
        `SELECT id FROM (SELECT \`id\` FROM \`${this.tableName}\` WHERE \`market\` = ? ORDER BY \`id\` DESC LIMIT ?) newest`,
        ')'
      ].join(' '),
      [market, market, this.keepPerMarket]
    );
    return result && typeof result.insertId !== 'undefined' ? Number(result.insertId) : null;
  }

  async latestByMarket(markets = []) {
    this.ensureDataSource();
    const wanted = (Array.isArray(markets) ? markets : []).map((market) => String(market).toUpperCase());
    if (wanted.length === 0) {
      return {};
    }
    try {
      const rows = await this.dataSource.query(
        [
          `SELECT r.* FROM \`${this.tableName}\` r`,
          `INNER JOIN (SELECT \`market\`, MAX(\`id\`) AS id FROM \`${this.tableName}\` WHERE \`market\` IN (${wanted.map(() => '?').join(', ')}) GROUP BY \`market\`) latest`,
          'ON latest.id = r.`id`'
        ].join(' '),
        wanted
      );
      const byMarket = {};
      for (const row of Array.isArray(rows) ? rows : []) {
        byMarket[row.market] = this.mapRun(row);
      }
      return byMarket;
    } catch (error) {
      if (isMissingTableError(error)) {
        return {};
      }
      throw error;
    }
  }

  async countByMarket(market) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(`SELECT COUNT(*) AS total FROM \`${this.tableName}\` WHERE \`market\` = ?`, [String(market).toUpperCase()]);
    return Number(rows && rows[0] && rows[0].total || 0);
  }

  mapRun(row) {
    const finishedAt = toIso(row.finished_at);
    return {
      syncJobId: `sync_${row.id}`,
      status: String(row.status),
      scope: String(row.scope),
      market: String(row.market),
      currency: row.currency ? String(row.currency) : undefined,
      productId: row.product_id ? String(row.product_id) : undefined,
      summary: parseSummary(row.summary),
      error: row.error ? String(row.error) : null,
      createdAt: toIso(row.started_at),
      updatedAt: finishedAt
    };
  }
}

module.exports = {
  CatalogSyncRunsRepository,
  RUNS_KEPT_PER_MARKET
};
