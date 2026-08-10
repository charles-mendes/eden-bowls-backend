class OnboardingSalesTaxQuoteRepository {
  async quote(sessionId, quote, context = {}) {
    return {
      session_id: sessionId,
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
