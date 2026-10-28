const { TtlCache } = require('../cache/ttl-cache');
const { HttpError } = require('../../core/http-error');
const { toIsoDateTime, toIsoDay } = require('./onboarding-pets.repository');

const CACHE_TTL_MS = 60 * 1000;
// Plans that still deliver: the same set the launch announcement and the age edit use.
const DELIVERING_STATUSES = ['active', 'trialing', 'past_due'];

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

function isDuplicateError(error) {
  const code = String((error && (error.code || error.errno)) || '');
  return code === 'ER_DUP_ENTRY' || code === '1062' || String(error && error.message).includes('ER_DUP_ENTRY');
}

function marketKey(market) {
  return String(market || '').trim().toUpperCase();
}

function mapSizeClass(row) {
  return {
    sizeClass: String(row.size_class),
    adultFromMonths: Number(row.adult_from_months),
    seniorFromMonths: Number(row.senior_from_months),
    updatedBy: row.updated_by == null ? null : Number(row.updated_by),
    updatedAt: toIsoDateTime(row.updated_at)
  };
}

function mapBreed(row) {
  return {
    id: Number(row.id),
    market: String(row.market),
    namePt: String(row.name_pt),
    nameEn: String(row.name_en),
    namePtNormalized: String(row.name_pt_normalized || ''),
    nameEnNormalized: String(row.name_en_normalized || ''),
    sizeClass: String(row.size_class),
    active: Boolean(Number(row.active)),
    updatedBy: row.updated_by == null ? null : Number(row.updated_by),
    updatedAt: toIsoDateTime(row.updated_at)
  };
}

const BREED_COLUMNS = 'id, market, name_pt, name_en, name_pt_normalized, name_en_normalized, size_class, active, updated_by, updated_at';

// Stage limits and breed classes per market, read from life_stage_size_classes and life_stage_breeds. The
// admin edits the rows directly; each write clears this process's cache and other processes read the change
// within the 60 s cache.
class LifeStageLimitsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
    this.tables = {
      subscriptions: options.subscriptionsTableName || 'stripe_subscriptions',
      pets: options.petsTableName || 'onboarding_pets'
    };
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  clearCache() {
    this.cache.clear();
  }

  // Every size class and every breed (active or not) of a market, as the admin page lists them.
  async listMarket(market) {
    this.ensureDataSource();
    const key = marketKey(market);
    const [limitRows, breedRows] = await Promise.all([
      this.dataSource.query(
        'SELECT size_class, adult_from_months, senior_from_months, updated_by, updated_at FROM life_stage_size_classes WHERE market = ?',
        [key]
      ),
      this.dataSource.query(
        `SELECT ${BREED_COLUMNS} FROM life_stage_breeds WHERE market = ? ORDER BY active DESC, name_pt ASC, id ASC`,
        [key]
      )
    ]);
    return {
      market: key,
      sizeClasses: (Array.isArray(limitRows) ? limitRows : []).map(mapSizeClass),
      breeds: (Array.isArray(breedRows) ? breedRows : []).map(mapBreed)
    };
  }

  // Writes the given size classes of a market in `manager` (a transaction).
  async saveLimits(market, limits, actorId = null, manager = this.dataSource) {
    for (const [sizeClass, limit] of Object.entries(limits)) {
      await manager.query(
        `INSERT INTO life_stage_size_classes (market, size_class, adult_from_months, senior_from_months, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE adult_from_months = VALUES(adult_from_months),
           senior_from_months = VALUES(senior_from_months), updated_by = VALUES(updated_by)`,
        [marketKey(market), sizeClass, limit.adultFromMonths, limit.seniorFromMonths, actorId]
      );
    }
    this.clearCache();
  }

  async findBreed(id, runner = this.dataSource) {
    this.ensureDataSource();
    const rows = await runner.query(`SELECT ${BREED_COLUMNS} FROM life_stage_breeds WHERE id = ? LIMIT 1`, [Number(id)]);
    return Array.isArray(rows) && rows[0] ? mapBreed(rows[0]) : null;
  }

  // Adds a breed to a market; the same pair of names twice answers 409 life_stage_breed_exists.
  async createBreed(market, breed, actorId = null, manager = this.dataSource) {
    let result;
    try {
      result = await manager.query(
        `INSERT INTO life_stage_breeds
           (market, name_pt, name_en, name_pt_normalized, name_en_normalized, size_class, active, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [marketKey(market), breed.namePt, breed.nameEn, breed.namePtNormalized, breed.nameEnNormalized,
          breed.sizeClass, breed.active === false ? 0 : 1, actorId]
      );
    } catch (error) {
      throw this.duplicateOr(error);
    }
    this.clearCache();
    return this.findBreed(result && result.insertId, manager);
  }

  // Changes the names, the size class or the active flag of a breed.
  async updateBreed(id, breed, actorId = null, manager = this.dataSource) {
    const columns = {
      namePt: 'name_pt',
      nameEn: 'name_en',
      namePtNormalized: 'name_pt_normalized',
      nameEnNormalized: 'name_en_normalized',
      sizeClass: 'size_class',
      active: 'active'
    };
    const sets = [];
    const params = [];
    for (const [key, column] of Object.entries(columns)) {
      if (breed[key] === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(key === 'active' ? (breed.active ? 1 : 0) : breed[key]);
    }
    try {
      await manager.query(
        `UPDATE life_stage_breeds SET ${sets.join(', ')}, updated_by = ? WHERE id = ?`,
        [...params, actorId, Number(id)]
      );
    } catch (error) {
      throw this.duplicateOr(error);
    }
    this.clearCache();
    return this.findBreed(id, manager);
  }

  duplicateOr(error) {
    return isDuplicateError(error)
      ? new HttpError(409, 'This breed is already listed for the market.', { code: 'life_stage_breed_exists' })
      : error;
  }

  // Pets of the customers with a delivering plan on a Stripe account, with the fields the stage needs.
  async listSubscribedPets(stripeAccount) {
    this.ensureDataSource();
    const { subscriptions, pets } = this.tables;
    const rows = await this.dataSource.query(
      `SELECT p.id, p.breed, p.size, p.age_years, p.age_months, p.age_recorded_at, p.birth_date
       FROM \`${pets}\` p
       WHERE p.deleted_at IS NULL
         AND p.user_id IN (
           SELECT s.user_id FROM \`${subscriptions}\` s
           WHERE s.stripe_account = ? AND s.status IN (${DELIVERING_STATUSES.map(() => '?').join(', ')})
         )`,
      [String(stripeAccount || '').toLowerCase(), ...DELIVERING_STATUSES]
    );
    return (Array.isArray(rows) ? rows : []).map((pet) => ({
      id: String(pet.id),
      breed: String(pet.breed || ''),
      size: String(pet.size || ''),
      age_years: Number(pet.age_years || 0),
      age_months: Number(pet.age_months || 0),
      age_recorded_at: toIsoDateTime(pet.age_recorded_at),
      birth_date: toIsoDay(pet.birth_date)
    }));
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
