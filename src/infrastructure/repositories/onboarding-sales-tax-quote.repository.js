class OnboardingSalesTaxQuoteRepository {
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
