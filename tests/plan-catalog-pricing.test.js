const { HttpError } = require('../src/core/http-error');
const {
  buildCatalogPricingSnapshot,
  buildPlanPreviewResponse,
  listFallbackCatalogItems,
  parseWeightToGrams,
  sanitizeFlavorSlug,
  uniqueSanitizeFlavors
} = require('../src/core/plan-catalog-pricing');
const { MARKETS } = require('../src/core/market');

describe('plan catalog pricing', () => {
  test('normalizes flavor slugs and drops duplicates', () => {
    expect(sanitizeFlavorSlug(' Beef ')).toBe('beef');
    expect(uniqueSanitizeFlavors(['beef', 'Beef', 'fish'])).toEqual(['beef', 'fish']);
  });

  test('parses gram and ounce pack labels', () => {
    expect(parseWeightToGrams('500 g')).toBe(500);
    expect(parseWeightToGrams('10.6oz')).toBeCloseTo(300.5047, 3);
  });

  test('prices Brazil beef packs from the local catalog without a term discount', () => {
    const pricing = buildCatalogPricingSnapshot(
      [{ pet_id: 'pet-1', pet_name: 'Luna', flavor: 'beef', quantity: 8, target_pack_size_grams: 500 }],
      listFallbackCatalogItems('BR'),
      MARKETS.BR
    );

    expect(pricing.subtotal).toBe(360);
    expect(pricing.discounted_first_month_total).toBe(360);
    expect(pricing.line_items[0]).toMatchObject({
      flavor: 'beef',
      quantity: 8,
      pack_size_grams: 500,
      pack_size_label: '500 g',
      unit_price: 45,
      line_total: 360,
      currency: 'BRL'
    });
  });

  test('rejects a flavor that is not in the catalog', () => {
    expect(() => buildCatalogPricingSnapshot(
      [{ pet_id: 'pet-1', pet_name: 'Luna', flavor: 'chicken', quantity: 2, target_pack_size_grams: 300 }],
      listFallbackCatalogItems('US'),
      MARKETS.US
    )).toThrow(HttpError);

    try {
      buildCatalogPricingSnapshot(
        [{ pet_id: 'pet-1', pet_name: 'Luna', flavor: 'chicken', quantity: 2, target_pack_size_grams: 300 }],
        listFallbackCatalogItems('US'),
        MARKETS.US
      );
    } catch (error) {
      expect(error.statusCode).toBe(422);
      expect(error.details.code).toBe('plan_selection_snapshot_mismatch');
    }
  });

  test('rejects a zero subtotal as an invalid preview contract', () => {
    expect(() => buildPlanPreviewResponse({
      subscription_term_months: 1,
      country: 'US',
      currency: 'USD',
      catalog_pricing: { subtotal: 0, line_items: [] }
    })).toThrow(HttpError);

    try {
      buildPlanPreviewResponse({
        subscription_term_months: 1,
        country: 'US',
        currency: 'USD',
        catalog_pricing: { subtotal: 0, line_items: [] }
      });
    } catch (error) {
      expect(error.statusCode).toBe(502);
      expect(error.details.code).toBe('invalid_plan_preview_contract');
    }
  });
});
