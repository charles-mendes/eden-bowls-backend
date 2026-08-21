const { OnboardingSalesTaxQuoteService } = require('../src/services/onboarding-sales-tax-quote.service');

function buildRepository() {
  return {
    getPlanSubtotal: jest.fn().mockResolvedValue(40),
    quote: jest.fn().mockImplementation(async (quote) => ({
      subtotal: quote.subtotal,
      product_tax: quote.productTax,
      product_tax_percent: quote.productTaxPercent,
      tax_jurisdiction: quote.taxJurisdiction,
      country: quote.country
    }))
  };
}

describe('OnboardingSalesTaxQuoteService', () => {
  test('returns zero tax with jurisdiction when Stripe automatic tax is enabled', async () => {
    const repository = buildRepository();
    const service = new OnboardingSalesTaxQuoteService(repository, { automaticTaxEnabled: true });

    const result = await service.quote({
      userId: 7,
      payload: { address: { country: 'US', state: 'CA', postal_code: '94105' } }
    });

    expect(result.data.product_tax).toBe(0);
    expect(result.data.tax_jurisdiction).toBe('US-CA');
    expect(result.data.subtotal).toBe(40);
  });

  test('returns zero tax when Stripe automatic tax is disabled instead of requiring price ids', async () => {
    const repository = buildRepository();
    const previewRepository = {
      getFallbackPriceIds: jest.fn(),
      preview: jest.fn()
    };
    const service = new OnboardingSalesTaxQuoteService(repository, {
      automaticTaxEnabled: false,
      previewRepository
    });

    const result = await service.quote({
      userId: 7,
      payload: { address: { country: 'US', state: 'NY', postal_code: '10118', city: 'New York City' } }
    });

    expect(result.success).toBe(true);
    expect(result.data.product_tax).toBe(0);
    expect(result.data.tax_jurisdiction).toBe('US-NY');
    expect(result.data.subtotal).toBe(40);
    expect(previewRepository.preview).not.toHaveBeenCalled();
    expect(previewRepository.getFallbackPriceIds).not.toHaveBeenCalled();
  });

  test('rejects US quotes without state or postal code', async () => {
    const service = new OnboardingSalesTaxQuoteService(buildRepository(), { automaticTaxEnabled: false });

    await expect(service.quote({
      userId: 7,
      payload: { address: { country: 'US', state: 'NY' } }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'sales_tax_unavailable', reason: 'missing_address' }
    });
  });
});
