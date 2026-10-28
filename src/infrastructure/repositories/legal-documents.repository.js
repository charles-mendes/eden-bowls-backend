const { TtlCache } = require('../cache/ttl-cache');
const { HttpError } = require('../../core/http-error');

const CACHE_TTL_MS = 60 * 1000;

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isDuplicateError(error) {
  const code = String((error && (error.code || error.errno)) || '');
  return code === 'ER_DUP_ENTRY' || code === '1062' || String(error && error.message).includes('ER_DUP_ENTRY');
}

function mapRow(row, withBody = true) {
  return {
    market: String(row.market),
    kind: String(row.kind),
    version: String(row.version),
    publishedAt: toIso(row.published_at),
    publishedBy: row.published_by == null ? null : Number(row.published_by),
    ...(withBody ? { body: String(row.body_markdown || '') } : {})
  };
}

// Published versions of the legal documents (legal-documents). Rows are only inserted. The current version
// of each market and kind is cached 60 s per process and cleared on publish.
class LegalDocumentsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'legal_documents';
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // The most recently published version, or null.
  async current(market, kind) {
    const key = `${market}:${kind}`;
    const cached = this.cache.get(key);
    if (cached !== undefined && cached !== null) {
      return cached;
    }
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT market, kind, version, body_markdown, published_at, published_by FROM \`${this.tableName}\`
       WHERE market = ? AND kind = ? ORDER BY published_at DESC, id DESC LIMIT 1`,
      [market, kind]
    );
    const document = Array.isArray(rows) && rows[0] ? mapRow(rows[0]) : null;
    return document ? this.cache.set(key, document, this.ttlMs) : null;
  }

  // Every version of a market and kind, newest first, without the bodies.
  async versions(market, kind) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT market, kind, version, published_at, published_by FROM \`${this.tableName}\`
       WHERE market = ? AND kind = ? ORDER BY published_at DESC, id DESC`,
      [market, kind]
    );
    return (Array.isArray(rows) ? rows : []).map((row) => mapRow(row, false));
  }

  async findVersion(market, kind, version) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT market, kind, version, body_markdown, published_at, published_by FROM \`${this.tableName}\`
       WHERE market = ? AND kind = ? AND version = ? LIMIT 1`,
      [market, kind, version]
    );
    return Array.isArray(rows) && rows[0] ? mapRow(rows[0]) : null;
  }

  // Inserts a version; an id already published for the market and kind answers 409 legal_version_taken.
  async publish({ market, kind, version, body, actorId = null }, manager = this.dataSource) {
    this.ensureDataSource();
    try {
      await manager.query(
        `INSERT INTO \`${this.tableName}\` (market, kind, version, body_markdown, published_at, published_by)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)`,
        [market, kind, version, body, actorId]
      );
    } catch (error) {
      if (isDuplicateError(error)) {
        throw new HttpError(409, 'This version id is already published.', { code: 'legal_version_taken' });
      }
      throw error;
    }
    this.cache.clear();
  }
}

module.exports = {
  LegalDocumentsRepository
};
