const { assertInsideDeliveryArea, currentBrDeliveryRadiusKm, MAX_DELIVERY_RADIUS_KM_BR } = require('../src/core/delivery-closed-days');
const { ShippingService } = require('../src/services/shipping.service');
const { loadShippingSettings } = require('../src/infrastructure/shipping/shipping-settings');

describe('Brazil delivery radius', () => {
  afterEach(() => {
    new ShippingService({ settings: loadShippingSettings() });
  });

  test('defaults to 50 km', () => {
    new ShippingService({ settings: loadShippingSettings() });

    expect(MAX_DELIVERY_RADIUS_KM_BR).toBe(50);
    expect(currentBrDeliveryRadiusKm()).toBe(50);
  });

  test('the checkout guard follows the radius saved in the shipping settings', () => {
    const settings = loadShippingSettings();
    const service = new ShippingService({ settings });
    service.settings = { ...settings, br: { ...settings.br, rule: { ...settings.br.rule, max_distance_km: 30 } } };

    expect(() => assertInsideDeliveryArea('BR', { distance: 31 })).toThrow('outside_delivery_area');
    expect(() => assertInsideDeliveryArea('BR', { distance: 30 })).not.toThrow();
  });
});
