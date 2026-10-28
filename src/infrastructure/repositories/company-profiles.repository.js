const { TtlCache } = require('../cache/ttl-cache');
const { HttpError } = require('../../core/http-error');
const { COMPANY_PROFILE_SEED, companyMarket } = require('../../core/company-profile');

const CACHE_TTL_MS = 60 * 1000;

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRow(row) {
  return {
    legalName: String(row.legal_name || ''),
    taxId: String(row.tax_id || ''),
    street: String(row.street || ''),
    complement: String(row.complement || ''),
    city: String(row.city || ''),
    state: String(row.state || ''),
    postalCode: String(row.postal_code || ''),
    country: String(row.country || ''),
    supportEmail: String(row.support_email || ''),
    storeUrl: String(row.store_url || ''),
    updatedBy: row.updated_by == null ? null : Number(row.updated_by),
    updatedAt: toIso(row.updated_at)
  };
}

// Company profile per market (company-profile), cached 60 s per process and cleared on save. Without the
// table, or without a row, the data printed before the table applies.
class CompanyProfilesRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'company_profiles';
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
  }

  async forMarket(market) {
    const key = companyMarket(market);
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    let rows = [];
    if (this.dataSource && this.dataSource.isInitialized) {
      try {
        rows = await this.dataSource.query(`SELECT * FROM \`${this.tableName}\` WHERE market = ? LIMIT 1`, [key]);
      } catch (error) {
        if (!isMissingTableError(error)) {
          throw error;
        }
      }
    }
    const profile = Array.isArray(rows) && rows[0]
      ? mapRow(rows[0])
      : { ...COMPANY_PROFILE_SEED[key], updatedBy: null, updatedAt: null };
    return this.cache.set(key, profile, this.ttlMs);
  }

  async save(market, profile, actorId = null, manager = this.dataSource) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
    await manager.query(
      `INSERT INTO \`${this.tableName}\`
         (market, legal_name, tax_id, street, complement, city, state, postal_code, country, support_email, store_url, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE legal_name = VALUES(legal_name), tax_id = VALUES(tax_id), street = VALUES(street),
         complement = VALUES(complement), city = VALUES(city), state = VALUES(state), postal_code = VALUES(postal_code),
         country = VALUES(country), support_email = VALUES(support_email), store_url = VALUES(store_url),
         updated_by = VALUES(updated_by)`,
      [companyMarket(market), profile.legalName, profile.taxId, profile.street, profile.complement, profile.city,
        profile.state, profile.postalCode, profile.country, profile.supportEmail, profile.storeUrl, actorId]
    );
    this.clearCache();
  }

  clearCache() {
    this.cache.clear();
  }
}

module.exports = {
  CompanyProfilesRepository
};
