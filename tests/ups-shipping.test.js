const { pickRate, serviceLabel } = require('../src/infrastructure/shipping/ups-client');
const { isPoBoxAddress, assertNotPoBoxAddress } = require('../src/core/po-box');
const { HttpError } = require('../src/core/http-error');
const { ShippingService } = require('../src/services/shipping.service');

describe('ups pickRate', () => {
  const shipments = [
    { Service: { Code: '02' }, TotalCharges: { MonetaryValue: '30.00', CurrencyCode: 'USD' } },
    { Service: { Code: '03' }, TotalCharges: { MonetaryValue: '18.50', CurrencyCode: 'USD' }, GuaranteedDelivery: { BusinessDaysInTransit: '4' } },
    { Service: { Code: '12' }, TotalCharges: { MonetaryValue: '22.00', CurrencyCode: 'USD' } }
  ];

  test('prefers Ground when allowed', () => {
    const picked = pickRate(shipments, ['03', '02']);
    expect(picked.serviceCode).toBe('03');
    expect(picked.monetaryValue).toBe(18.5);
    expect(picked.deliveryDays).toBe(4);
    expect(serviceLabel('03')).toContain('Ground');
  });

  test('falls back to cheapest allowed when Ground missing', () => {
    const picked = pickRate(shipments, ['02', '12']);
    expect(picked.serviceCode).toBe('12');
    expect(picked.monetaryValue).toBe(22);
  });
});

describe('shipping service settings and the CIE dry ice switch', () => {
  const { currentSkipDryIceInTest, setSkipDryIceInTest } = require('../src/infrastructure/shipping/ups-client');
  afterEach(() => setSkipDryIceInTest(false));

  test('loading or saving the settings sets the switch every UPS client reads', () => {
    const base = { br: { enabled: true, label: 'BR', center: { lat: 0, lng: 0 }, rule: {} }, us: { enabled: true } };
    const service = new ShippingService({ settings: { ...base, us: { ...base.us, skip_dry_ice_in_test: true } } });
    expect(currentSkipDryIceInTest()).toBe(true);
    service.settings = base;
    expect(currentSkipDryIceInTest()).toBe(false);
  });
});

describe('po box guard', () => {
  test('detects common PO Box patterns', () => {
    expect(isPoBoxAddress('P.O. Box 123')).toBe(true);
    expect(isPoBoxAddress('PO Box 99')).toBe(true);
    expect(isPoBoxAddress('123 Main St')).toBe(false);
  });

  test('throws HttpError for PO Box addresses', () => {
    expect(() => assertNotPoBoxAddress({ line1: 'PO Box 1' })).toThrow(HttpError);
  });
});

describe('ShippingService US calculate', () => {
  test('returns fixed quote when quote_mode is fixed', async () => {
    const service = new ShippingService({
      settings: {
        br: { enabled: true, label: 'BR', center: { lat: 0, lng: 0 }, rule: {} },
        us: {
          enabled: true,
          cost: 12.9,
          label: 'FedEx 3–5 business days',
          carrier: 'FedEx',
          delivery: '3–5 business days',
          quote_mode: 'fixed',
          fallback_enabled: true,
          ship_from: { zipcode: '10001' },
          package: { weight_lb: 10, length_in: 12, width_in: 12, height_in: 12 },
          allowed_service_codes: ['03']
        }
      }
    });

    const result = await service.calculate({ country: 'US', zipCode: '94105' });
    expect(result.data.source).toBe('fixed');
    expect(result.data.method_id).toBe('fixed_us');
    expect(result.data.shipping).toBe(12.9);
  });

  test('uses UPS rate when quote_mode is ups', async () => {
    const upsClient = {
      isConfigured: () => true,
      rate: jest.fn().mockResolvedValue({
        serviceCode: '03',
        monetaryValue: 19.25,
        deliveryDays: 5,
        currency: 'USD',
        label: 'UPS Ground'
      })
    };
    const service = new ShippingService({
      settings: {
        br: { enabled: true, label: 'BR', center: { lat: 0, lng: 0 }, rule: {} },
        us: {
          enabled: true,
          cost: 12.9,
          label: 'Fallback',
          carrier: 'FedEx',
          delivery: '3–5 business days',
          quote_mode: 'ups',
          fallback_enabled: true,
          ship_from: { name: 'WH', street: '1 St', city: 'NY', state: 'NY', zipcode: '10001', country: 'US' },
          package: { weight_lb: 10, length_in: 12, width_in: 12, height_in: 12, dry_ice_kg: 0.5 },
          allowed_service_codes: ['03']
        }
      },
      upsClient
    });

    const result = await service.calculate({ country: 'US', zipCode: '94105' });
    expect(result.data.source).toBe('ups');
    expect(result.data.shipping).toBe(19.25);
    expect(result.data.rate_id).toBe('ups:03');
    // Quote with charges off: the UPS rate is the original the store strikes through; the customer pays 0.
    expect(result.data).toMatchObject({ original_amount: 19.25, charged_amount: 0, charge_enabled: false });
    // Checkout quote: the stored package, dry ice included, reaches UPS (ups-dry-ice).
    expect(upsClient.rate).toHaveBeenCalledWith(expect.objectContaining({
      package: expect.objectContaining({ weight_lb: 10, dry_ice_kg: 0.5 })
    }));
    // A bare ZIP reaches UPS with no made-up street, city or state, and the quote asks for transit days.
    expect(upsClient.rate).toHaveBeenCalledWith(expect.objectContaining({
      shipTo: expect.objectContaining({ street: '', city: '', state: '', zipcode: '94105', country: 'US' }),
      withTransit: true
    }));
    expect(result.data.delivery_days).toBe(5);

    upsClient.rate.mockClear();
    await service.calculate({ country: 'US', zipCode: '33432', city: ' Boca Raton ', state: 'fl' });
    expect(upsClient.rate).toHaveBeenCalledWith(expect.objectContaining({
      shipTo: expect.objectContaining({ city: 'Boca Raton', state: 'FL', zipcode: '33432' })
    }));

    upsClient.rate.mockClear();
    await service.calculate({ country: 'US', zipCode: '33432', state: 'Florida' });
    expect(upsClient.rate).toHaveBeenCalledWith(expect.objectContaining({
      shipTo: expect.objectContaining({ state: '' })
    }));
  });

  test('falls back when UPS times out and fallback is enabled', async () => {
    const error = new HttpError(504, 'timeout', { code: 'ups_timeout' });
    error.upsTimeout = true;
    const logger = { warn: jest.fn() };
    const upsClient = {
      isConfigured: () => true,
      rate: jest.fn().mockRejectedValue(error)
    };
    const service = new ShippingService({
      settings: {
        br: { enabled: true, label: 'BR', center: { lat: 0, lng: 0 }, rule: {} },
        us: {
          enabled: true,
          cost: 14.5,
          label: 'Fallback',
          carrier: 'FedEx',
          delivery: '3–5',
          quote_mode: 'ups',
          fallback_enabled: true,
          ship_from: { zipcode: '10001' },
          package: { weight_lb: 10, length_in: 12, width_in: 12, height_in: 12 },
          allowed_service_codes: ['03']
        }
      },
      upsClient,
      logger
    });

    const result = await service.calculate({ country: 'US', zipCode: '94105' });
    expect(result.data.source).toBe('fallback');
    expect(result.data.shipping).toBe(14.5);
    // The fallback has no transit days and checkout refuses it, so the UPS failure must reach the log.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'ups_rate_failed', code: 'ups_timeout', status: 504 }),
      expect.stringContaining('fell back')
    );
  });
});
