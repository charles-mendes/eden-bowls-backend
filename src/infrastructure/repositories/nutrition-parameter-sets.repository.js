const { TtlCache } = require('../cache/ttl-cache');
const { HttpError } = require('../../core/http-error');
const { DEFAULT_NUTRITION_PARAMETERS } = require('../../core/nutrition-recommendation');

const CACHE_TTL_MS = 60 * 1000;
const PUBLISHED_KEY = 'published';

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

function parseJson(value) {
  if (value && typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(String(value || 'null'));
  } catch (_error) {
    return null;
  }
}

function toIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRow(row) {
  return {
    id: Number(row.id),
    status: String(row.status),
    parameters: parseJson(row.parameters),
    createdBy: row.created_by == null ? null : Number(row.created_by),
    publishedBy: row.published_by == null ? null : Number(row.published_by),
    publishedAt: toIso(row.published_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

// Nutrition parameter sets (nutrition-parameters): one published, at most one draft, the rest retired. The
// published set is cached for 60 s per process and the cache is cleared on publish; without the table the
// values the code used before it apply, with no id.
class NutritionParameterSetsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'nutrition_parameter_sets';
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async findOne(where, params, runner = this.dataSource) {
    const rows = await runner.query(
      `SELECT id, status, parameters, created_by, published_by, published_at, created_at, updated_at
       FROM \`${this.tableName}\` WHERE ${where} ORDER BY id DESC LIMIT 1`,
      params
    );
    return Array.isArray(rows) && rows[0] ? mapRow(rows[0]) : null;
  }

  // { id, parameters } of the published set; id null when the table does not exist yet.
  async published() {
    const cached = this.cache.get(PUBLISHED_KEY);
    if (cached) {
      return cached;
    }
    this.ensureDataSource();
    let set = null;
    try {
      set = await this.findOne("status = 'published'", []);
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }
    const value = set && set.parameters
      ? { id: set.id, parameters: set.parameters, publishedAt: set.publishedAt }
      : { id: null, parameters: DEFAULT_NUTRITION_PARAMETERS, publishedAt: null };
    return this.cache.set(PUBLISHED_KEY, value, this.ttlMs);
  }

  async draft() {
    this.ensureDataSource();
    return this.findOne("status = 'draft'", []);
  }

  // Published and retired sets, newest first.
  async history(limit = 50) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT id, status, parameters, created_by, published_by, published_at, created_at, updated_at
       FROM \`${this.tableName}\` WHERE status IN ('published', 'retired') ORDER BY id DESC LIMIT ?`,
      [Math.max(1, Math.min(200, Number(limit) || 50))]
    );
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  }

  async findById(id) {
    this.ensureDataSource();
    return this.findOne('id = ?', [Number(id)]);
  }

  // Creates the draft or replaces its parameters; there is at most one.
  async saveDraft({ parameters, actorId = null }) {
    this.ensureDataSource();
    const current = await this.draft();
    if (current) {
      await this.dataSource.query(
        `UPDATE \`${this.tableName}\` SET parameters = ?, created_by = COALESCE(created_by, ?) WHERE id = ? AND status = 'draft'`,
        [JSON.stringify(parameters), actorId, current.id]
      );
      return this.findById(current.id);
    }
    const result = await this.dataSource.query(
      `INSERT INTO \`${this.tableName}\` (status, parameters, created_by) VALUES ('draft', ?, ?)`,
      [JSON.stringify(parameters), actorId]
    );
    return this.findById(result && result.insertId);
  }

  async deleteDraft() {
    this.ensureDataSource();
    await this.dataSource.query(`DELETE FROM \`${this.tableName}\` WHERE status = 'draft'`);
  }

  // Makes the draft the published set and retires the previous one, in `manager` (a transaction).
  async publishDraft({ draftId, actorId = null }, manager) {
    await manager.query(
      `UPDATE \`${this.tableName}\` SET status = 'retired' WHERE status = 'published'`
    );
    await manager.query(
      `UPDATE \`${this.tableName}\` SET status = 'published', published_by = ?, published_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'draft'`,
      [actorId, Number(draftId)]
    );
    this.cache.clear();
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = {
  NutritionParameterSetsRepository
};
