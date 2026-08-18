function parseJsonColumn(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

class OnboardingSalesTaxQuoteRepository {
  constructor(dataSource, options = {}) {
    this.dataSource = dataSource;
    this.tableName = options.tableName || 'onboarding_user_state';
  }

  async getPlanSubtotal(userId) {
    if (!this.dataSource || !this.dataSource.isInitialized) {
      return 0;
    }

    const rows = await this.dataSource.query(
      `SELECT \`plan_selection\` FROM \`${this.tableName}\` WHERE \`user_id\` = ? LIMIT 1`,
      [userId]
    );
    const planSelection = parseJsonColumn(Array.isArray(rows) && rows[0] ? rows[0].plan_selection : null);
    const catalog = planSelection && planSelection.catalog_pricing ? planSelection.catalog_pricing : {};
    const cached = planSelection && planSelection.product_tax ? planSelection.product_tax : {};
    const subtotal = Number(catalog.subtotal != null ? catalog.subtotal : cached.subtotal);
    return Number.isFinite(subtotal) ? subtotal : 0;
  }

  async quote(quote) {
    return {
      subtotal: quote.subtotal,
      product_tax: quote.productTax,
      product_tax_percent: quote.productTaxPercent,
      tax_jurisdiction: quote.taxJurisdiction,
      country: quote.country
    };
  }
}

module.exports = {
  OnboardingSalesTaxQuoteRepository
};
