const { OnboardingSalesTaxQuoteService } = require('../src/services/onboarding-sales-tax-quote.service');

describe('OnboardingSalesTaxQuoteService', () => {
  test('returns zero tax with jurisdiction when Stripe automatic tax is enabled', async () => {
    const repository = {
      getPlanSubtotal: jest.fn().mockResolvedValue(40),
      quote: jest.fn().mockImplementation(async (quote) => ({
        subtotal: quote.subtotal,
        product_tax: quote.productTax,
        product_tax_percent: quote.productTaxPercent,
        tax_jurisdiction: quote.taxJurisdiction,
        country: quote.country
      }))
    };
    const service = new OnboardingSalesTaxQuoteService(repository, { automaticTaxEnabled: true });

    const result = await service.quote({
      userId: 7,
      payload: { address: { country: 'US', state: 'CA', postal_code: '94105' } }
    });

    expect(result.data.product_tax).toBe(0);
    expect(result.data.tax_jurisdiction).toBe('US-CA');
    expect(result.data.subtotal).toBe(40);
  });
});
