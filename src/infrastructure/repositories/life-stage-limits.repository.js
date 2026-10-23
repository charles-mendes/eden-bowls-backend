const { TtlCache } = require('../cache/ttl-cache');

const CACHE_TTL_MS = 60 * 1000;

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

// Stage limits and breed classes per market, read from life_stage_size_classes and life_stage_breeds.
class LifeStageLimitsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
  }

  async forMarket(market) {
    const key = String(market || '').trim().toUpperCase();
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    let limitRows = [];
    let breedRows = [];
    try {
      [limitRows, breedRows] = await Promise.all([
        this.dataSource.query(
          'SELECT size_class, adult_from_months, senior_from_months FROM life_stage_size_classes WHERE market = ?',
          [key]
        ),
        this.dataSource.query(
          'SELECT name_pt_normalized, name_en_normalized, size_class FROM life_stage_breeds WHERE market = ? AND active = 1',
          [key]
        )
      ]);
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }

    const limits = {};
    for (const row of Array.isArray(limitRows) ? limitRows : []) {
      limits[row.size_class] = {
        adultFromMonths: Number(row.adult_from_months),
        seniorFromMonths: Number(row.senior_from_months)
      };
    }
    const breedClasses = new Map();
    for (const row of Array.isArray(breedRows) ? breedRows : []) {
      for (const name of [row.name_pt_normalized, row.name_en_normalized]) {
        if (name && !breedClasses.has(name)) {
          breedClasses.set(name, row.size_class);
        }
      }
    }

    return this.cache.set(key, { limits, breedClasses }, this.ttlMs);
  }
}

module.exports = {
  LifeStageLimitsRepository
};
