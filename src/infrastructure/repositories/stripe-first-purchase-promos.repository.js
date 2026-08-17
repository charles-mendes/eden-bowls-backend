const { HttpError } = require('../../core/http-error');
const { isPromoId, VALID_SUBSCRIPTION_TERMS } = require('../../core/first-purchase-discount');

class StripeFirstPurchasePromosRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.promosTableName = options.promosTableName || 'stripe_first_purchase_promos';
    this.metricsTableName = options.metricsTableName || 'stripe_first_purchase_promo_metrics';
  }

  ensureDataSource() {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  async getMapping() {
    this.ensureDataSource();

    const rows = await this.dataSource.query(
      `SELECT \`term_months\`, \`promotion_code_id\`, \`coupon_id\` FROM \`${this.promosTableName}\``
    );
    const mapping = { 1: null, 3: null, 6: null };
    const coupons = { 1: null, 3: null, 6: null };

    for (const row of Array.isArray(rows) ? rows : []) {
      const term = Number(row.term_months);
      if (!VALID_SUBSCRIPTION_TERMS.includes(term)) {
        continue;
      }

      const promoId = String(row.promotion_code_id || '');
      mapping[term] = isPromoId(promoId) ? promoId : null;
      coupons[term] = row.coupon_id ? String(row.coupon_id) : null;
    }

    return { mapping, coupons };
  }

  async saveMapping(mapping = {}, coupons = {}) {
    this.ensureDataSource();

    for (const term of VALID_SUBSCRIPTION_TERMS) {
      const promoId = mapping[term] || mapping[String(term)] || '';
      if (!isPromoId(promoId)) {
        continue;
      }

      const couponId = coupons[term] || coupons[String(term)] || null;
      await this.dataSource.query(
        `INSERT INTO \`${this.promosTableName}\` (\`term_months\`, \`promotion_code_id\`, \`coupon_id\`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE \`promotion_code_id\` = VALUES(\`promotion_code_id\`), \`coupon_id\` = VALUES(\`coupon_id\`)`,
        [term, promoId, couponId]
      );
    }
  }

  async getMisconfigCount() {
    this.ensureDataSource();

    const rows = await this.dataSource.query(
      `SELECT \`metric_value\` FROM \`${this.metricsTableName}\` WHERE \`metric_key\` = 'misconfig_count' LIMIT 1`
    );
    const row = Array.isArray(rows) ? rows[0] : null;
    return Number(row && row.metric_value) || 0;
  }

  async incrementMisconfigCount() {
    this.ensureDataSource();

    await this.dataSource.query(
      `INSERT INTO \`${this.metricsTableName}\` (\`metric_key\`, \`metric_value\`) VALUES ('misconfig_count', 1) ON DUPLICATE KEY UPDATE \`metric_value\` = \`metric_value\` + 1`
    );

    return this.getMisconfigCount();
  }
}

module.exports = {
  StripeFirstPurchasePromosRepository
};
