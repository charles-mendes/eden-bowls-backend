const {
  applyShippingFee,
  billableDistanceKm,
  deliveryDays,
  formatBrZipcode,
  haversineMeters
} = require('../src/core/shipping-fee');

describe('shipping-fee', () => {
  test('applies per_km and clamps delivery days to the minimum', () => {
    const fee = applyShippingFee(18.5, { per_km: 0.95, min_fee: 0 });
    expect(fee.shipping).toBe(17.58);
    expect(fee.raw).toBe(17.58);
    expect(fee.minimumApplied).toBe(false);
    expect(deliveryDays(18.5, { km_per_day: 80, min_days: 2, max_days: 10 })).toBe(2);
  });

  test('multiplies haversine distance by the road factor', () => {
    expect(billableDistanceKm(10000, 'osrm', 1.3)).toBe(10);
    expect(billableDistanceKm(10000, 'haversine_fallback', 1.3)).toBe(13);
  });

  test('applies min and max fees', () => {
    const floor = applyShippingFee(1, { per_km: 0.95, min_fee: 10 });
    expect(floor.shipping).toBe(10);
    expect(floor.minimumApplied).toBe(true);

    const cap = applyShippingFee(1000, { per_km: 0.95, max_fee: 20 });
    expect(cap.shipping).toBe(20);
    expect(cap.maximumApplied).toBe(true);
  });

  test('formats Brazilian zipcodes and computes haversine meters', () => {
    expect(formatBrZipcode('80010000')).toBe('80010-000');
    const meters = haversineMeters(
      { lat: -25.4284, lng: -49.2733 },
      { lat: -25.4284, lng: -49.2733 }
    );
    expect(meters).toBe(0);
  });
});
