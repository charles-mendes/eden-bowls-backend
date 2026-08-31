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

  test('prices localized flavor slugs against the english catalog keys', () => {
    const pricing = buildCatalogPricingSnapshot(
      [
        { pet_id: 'pet-1', pet_name: 'Luna', flavor: 'bovino', quantity: 5, target_pack_size_grams: 500 },
        { pet_id: 'pet-1', pet_name: 'Luna', flavor: 'frango', quantity: 5, target_pack_size_grams: 500 }
      ],
      [
        { flavor: 'Bovino', weight: '500g', price: 45, currency: 'BRL', variation_id: 1005, product_id: 100 },
        { flavor: 'Frango', weight: '500g', price: 42.5, currency: 'BRL', variation_id: 1008, product_id: 100 }
      ],
      MARKETS.BR
    );

    expect(pricing.subtotal).toBe(437.5);
    expect(pricing.line_items).toEqual([
      expect.objectContaining({ flavor: 'bovino', variation_id: 1005, unit_price: 45, line_total: 225 }),
      expect.objectContaining({ flavor: 'frango', variation_id: 1008, unit_price: 42.5, line_total: 212.5 })
    ]);
  });

  test('matches bovino requests to beef variations in the fallback catalog', () => {
    const pricing = buildCatalogPricingSnapshot(
      [{ pet_id: 'pet-1', pet_name: 'Luna', flavor: 'bovino', quantity: 8, target_pack_size_grams: 500 }],
      listFallbackCatalogItems('BR'),
      MARKETS.BR
    );

    expect(pricing.line_items[0]).toMatchObject({
      flavor: 'bovino',
      pack_size_grams: 500,
      unit_price: 45,
      line_total: 360
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
