const { TtlCache } = require('../cache/ttl-cache');
const { HttpError } = require('../../core/http-error');
const { LARGE_PACK_THRESHOLD, PERIOD_DAYS } = require('../../core/simplified-consumption');

const CACHE_TTL_MS = 60 * 1000;

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return Boolean(error && (error.code === 'ER_NO_SUCH_TABLE' || error.errno === 1146))
    || message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeMarket(market) {
  return String(market || '').trim().toUpperCase();
}

// Plan settings per market (plan-settings), cached 60 s per process and cleared on save. Without the table or
// a row, the recommendation's own fallbacks apply (30 days, limit 8), with `stored` false.
class PlanSettingsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'plan_settings';
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
  }

  async read(market) {
    const key = normalizeMarket(market);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    let rows = [];
    if (this.dataSource && this.dataSource.isInitialized) {
      try {
        rows = await this.dataSource.query(
          `SELECT market, plan_days, large_pack_limit, updated_by, updated_at FROM \`${this.tableName}\` WHERE market = ? LIMIT 1`,
          [key]
        );
      } catch (error) {
        if (!isMissingTableError(error)) {
          throw error;
        }
      }
    }
    const row = Array.isArray(rows) ? rows[0] : null;
    const settings = row
      ? {
        market: key,
        planDays: Number(row.plan_days),
        largePackLimit: Number(row.large_pack_limit),
        stored: true,
        updatedBy: row.updated_by == null ? null : Number(row.updated_by),
        updatedAt: toIso(row.updated_at)
      }
      : { market: key, planDays: PERIOD_DAYS, largePackLimit: LARGE_PACK_THRESHOLD, stored: false, updatedBy: null, updatedAt: null };
    return this.cache.set(key, settings, this.ttlMs);
  }

  async save(market, { planDays, largePackLimit }, actorId = null, manager = this.dataSource) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
    await manager.query(
      `INSERT INTO \`${this.tableName}\` (market, plan_days, large_pack_limit, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE plan_days = VALUES(plan_days), large_pack_limit = VALUES(large_pack_limit),
         updated_by = VALUES(updated_by)`,
      [normalizeMarket(market), planDays, largePackLimit, actorId]
    );
    this.clearCache();
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = {
  PlanSettingsRepository
};
