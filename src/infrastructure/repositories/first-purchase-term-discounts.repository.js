const { TtlCache } = require('../cache/ttl-cache');
const { HttpError } = require('../../core/http-error');
const { TERM_PERCENT_MAP, VALID_SUBSCRIPTION_TERMS } = require('../../core/first-purchase-discount');
const { normalizeStripeAccount } = require('../../core/stripe-account');

const CACHE_TTL_MS = 60 * 1000;

function isMissingTableError(error) {
  const message = String(error && error.message ? error.message : '');
  return message.includes('ER_NO_SUCH_TABLE') || message.includes("doesn't exist");
}

// First-invoice discount percent per Stripe account and term (first-purchase-discount). Reads are cached for
// 60 s per account and the cache is cleared on save; without the table the percents of before it apply.
class FirstPurchaseTermDiscountsRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'first_purchase_term_discounts';
    this.cache = options.cache || new TtlCache();
    this.ttlMs = options.ttlMs == null ? CACHE_TTL_MS : options.ttlMs;
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // { 1: percent, 3: percent, 6: percent } of the account.
  async percentsFor(account) {
    const stripeAccount = normalizeStripeAccount(account);
    const cached = this.cache.get(stripeAccount);
    if (cached) {
      return { ...cached };
    }
    this.ensureDataSource();

    let rows = [];
    try {
      rows = await this.dataSource.query(
        `SELECT term_months, discount_percent FROM \`${this.tableName}\` WHERE stripe_account = ?`,
        [stripeAccount]
      );
    } catch (error) {
      if (!isMissingTableError(error)) {
        throw error;
      }
    }
    const percents = { ...TERM_PERCENT_MAP };
    for (const row of Array.isArray(rows) ? rows : []) {
      const term = Number(row.term_months);
      if (VALID_SUBSCRIPTION_TERMS.includes(term)) {
        percents[term] = Number(row.discount_percent);
      }
    }
    return { ...this.cache.set(stripeAccount, percents, this.ttlMs) };
  }

  // Writes through `manager` (a transaction's EntityManager) when given.
  async savePercent({ account, termMonths, percent, actorId = null }, manager = null) {
    const runner = manager || this.dataSource;
    if (!manager) {
      this.ensureDataSource();
    }
    await runner.query(
      `INSERT INTO \`${this.tableName}\` (stripe_account, term_months, discount_percent, updated_by) VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent), updated_by = VALUES(updated_by)`,
      [normalizeStripeAccount(account), Number(termMonths), Number(percent), actorId]
    );
    this.cache.clear();
  }
}

module.exports = {
  FirstPurchaseTermDiscountsRepository
};
