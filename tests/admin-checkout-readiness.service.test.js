const { AdminCheckoutReadinessService } = require('../src/services/admin-checkout-readiness.service');
const { ShippingService } = require('../src/services/shipping.service');

function upsClient({ configured = true, rate } = {}) {
  return {
    isConfigured: () => configured,
    rate: rate || jest.fn().mockResolvedValue({ serviceCode: '03', monetaryValue: 33.76, deliveryDays: 1 })
  };
}

function settings({ us = {}, center = { lat: -25.44839, lng: -49.21741 } } = {}) {
  return {
    br: { center, rule: {} },
    us: {
      quote_mode: 'ups',
      ship_from: { zipcode: '10001', city: 'New York', state: 'NY', street: '1 Main St' },
      package: { weight_lb: 10 },
      allowed_service_codes: ['03'],
      ...us
    }
  };
}

function shipping(options = {}) {
  return new ShippingService({ settings: settings(options), upsClient: options.ups || upsClient() });
}

function catalog(statusByMarket = {}) {
  return {
    health: jest.fn(async ({ market }) => ({
      market,
      stripe_account: { status: statusByMarket[market] || 'ok', missing_variation_ids: statusByMarket[`${market}_missing`] || [] }
    }))
  };
}

function coupons(byAccount = {}) {
  return {
    checkoutReadiness: jest.fn(async (account) => ({ stripe_account: account, missing_terms: [], unverified: false, ...(byAccount[account] || {}) }))
  };
}

function service(overrides = {}) {
  return new AdminCheckoutReadinessService({
    adminCatalogService: overrides.catalog || catalog(),
    stripeCouponService: overrides.coupons || coupons(),
    shippingService: overrides.shipping || shipping(),
    stripeBrEnabled: overrides.stripeBrEnabled !== false,
    stripeSecretKeyPresent: overrides.keys || { BR: true, US: true },
    now: () => new Date('2026-11-18T12:00:00.000Z')
  });
}

const codes = (result) => result.warnings.map((item) => `${item.market}:${item.code}`);

describe('AdminCheckoutReadinessService', () => {
  test('an all-good setup has no warning and no note', async () => {
    const result = await service().read();

    expect(result).toEqual({
      checked_at: '2026-11-18T12:00:00.000Z',
      config: { stripe_br_enabled: true, stripe_secret_key_present: { BR: true, US: true }, ups_configured: true },
      warnings: [],
      notes: []
    });
  });

  test.each([
    ['never_synced', 'catalog_never_synced'],
    ['account_changed', 'catalog_account_changed'],
    ['prices_missing', 'catalog_prices_missing']
  ])('catalog %s is a warning of that market with the Produtos action', async (status, code) => {
    const result = await service({ catalog: catalog({ US: status, US_missing: ['21'] }) }).read();

    expect(result.warnings).toEqual([expect.objectContaining({ key: 'catalog:US', code, market: 'US', severity: 'high', action: 'products' })]);
  });

  test('catalog unverified is a note, not a warning', async () => {
    const result = await service({ catalog: catalog({ BR: 'unverified' }) }).read();

    expect(result.warnings).toEqual([]);
    expect(result.notes).toEqual([{ key: 'stripe:BR', code: 'stripe_unverified', market: 'BR' }]);
  });

  test('missing coupon terms are one medium warning per market', async () => {
    const result = await service({ coupons: coupons({ br: { missing_terms: [3] } }) }).read();

    expect(result.warnings).toEqual([
      { key: 'coupon:BR', code: 'coupon_missing', market: 'BR', severity: 'medium', action: 'coupons', details: { terms: [3] } }
    ]);
  });

  test('an unverified coupon check is a note, shared with the catalog note of the market', async () => {
    const result = await service({ catalog: catalog({ US: 'unverified' }), coupons: coupons({ us: { unverified: true } }) }).read();

    expect(result.notes).toEqual([{ key: 'stripe:US', code: 'stripe_unverified', market: 'US' }]);
  });

  test('Brazil disabled is one Brazil warning without action, and skips the Brazil Stripe checks', async () => {
    const catalogService = catalog({ BR: 'never_synced' });
    const couponService = coupons({ br: { missing_terms: [1, 3, 6] } });
    const result = await service({ stripeBrEnabled: false, catalog: catalogService, coupons: couponService }).read();

    expect(result.warnings).toEqual([expect.objectContaining({ code: 'stripe_br_disabled', market: 'BR', action: null })]);
    expect(catalogService.health).not.toHaveBeenCalledWith(expect.objectContaining({ market: 'BR' }), expect.anything());
    expect(couponService.checkoutReadiness).not.toHaveBeenCalledWith('br');
    expect(result.config.stripe_br_enabled).toBe(false);
  });

  test('an empty US key is a US warning without action and skips the US Stripe checks', async () => {
    const couponService = coupons({ us: { missing_terms: [1] } });
    const result = await service({ keys: { BR: true, US: false }, coupons: couponService }).read();

    expect(result.warnings).toEqual([expect.objectContaining({ key: 'secret_key:US', code: 'stripe_secret_key_missing', market: 'US', action: null })]);
    expect(couponService.checkoutReadiness).not.toHaveBeenCalledWith('us');
    expect(result.config.stripe_secret_key_present).toEqual({ BR: true, US: false });
  });

  test('a Brazil center without coordinates is a Brazil warning to the Brazil shipping tab', async () => {
    const result = await service({ shipping: shipping({ center: { lat: 0, lng: 0 } }) }).read();

    expect(result.warnings).toEqual([expect.objectContaining({ key: 'center:BR', code: 'br_center_missing', market: 'BR', action: 'shipping_br' })]);
  });

  test('a missing Brazil center is the same warning', async () => {
    const result = await service({ shipping: shipping({ center: {} }) }).read();
    expect(codes(result)).toEqual(['BR:br_center_missing']);
  });

  test('out-of-scope settings do not add a warning', async () => {
    // Publishable keys, webhook secrets and SMTP are not inputs of this service at all.
    const readiness = new AdminCheckoutReadinessService({
      adminCatalogService: catalog(),
      stripeCouponService: coupons(),
      shippingService: shipping(),
      stripeBrEnabled: true,
      stripeSecretKeyPresent: { BR: true, US: true },
      VITE_STRIPE_PUBLISHABLE_KEY_US: '',
      STRIPE_US_WEBHOOK_SECRET: '',
      SMTP_HOST: ''
    });
    expect((await readiness.read()).warnings).toEqual([]);
  });

  describe('United States shipping', () => {
    test.each([
      ['fixed quote mode', { us: { quote_mode: 'fixed' } }, 'us_shipping_fixed'],
      ['UPS without credentials', { ups: upsClient({ configured: false }) }, 'us_ups_not_configured'],
      ['no ship-from ZIP', { us: { ship_from: { zipcode: '' } } }, 'us_ship_from_missing']
    ])('%s is a US warning to Regras de frete', async (_label, options, code) => {
      const result = await service({ shipping: shipping(options) }).read();

      expect(result.warnings).toEqual([expect.objectContaining({ key: 'shipping:US', code, market: 'US', severity: 'high', action: 'shipping_us' })]);
    });

    test('ups_configured is a boolean only', async () => {
      const result = await service({ shipping: shipping({ ups: upsClient({ configured: false }) }) }).read();
      expect(result.config.ups_configured).toBe(false);
    });

    test('the probe rates the ship-from address to itself with transit days', async () => {
      const ups = upsClient();
      await service({ shipping: shipping({ ups }) }).read();

      expect(ups.rate).toHaveBeenCalledWith(expect.objectContaining({
        shipFrom: expect.objectContaining({ zipcode: '10001' }),
        shipTo: expect.objectContaining({ zipcode: '10001', state: 'NY', country: 'US' }),
        withTransit: true
      }));
    });

    test.each([
      ['no transit days', jest.fn().mockResolvedValue({ serviceCode: '03', monetaryValue: 20, deliveryDays: null })],
      ['no rate', jest.fn().mockRejectedValue(Object.assign(new Error('No rates'), { details: { code: 'ups_no_rates' } }))]
    ])('a quote with %s is the reserve-rate warning', async (_label, rate) => {
      const result = await service({ shipping: shipping({ ups: upsClient({ rate }) }) }).read();
      expect(codes(result)).toEqual(['US:us_ups_quote_fallback']);
    });

    test('a UPS timeout is a note, not a warning', async () => {
      const rate = jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { upsTimeout: true }));
      const result = await service({ shipping: shipping({ ups: upsClient({ rate }) }) }).read();

      expect(result.warnings).toEqual([]);
      expect(result.notes).toEqual([{ key: 'ups:US', code: 'ups_unverified', market: 'US' }]);
    });

    test('the probe is reused and saving the settings asks UPS again', async () => {
      const ups = upsClient();
      const shippingService = shipping({ ups });
      const readiness = service({ shipping: shippingService });

      await readiness.read();
      await readiness.read();
      expect(ups.rate).toHaveBeenCalledTimes(1);

      shippingService.settings = settings();
      await readiness.read();
      expect(ups.rate).toHaveBeenCalledTimes(2);
    });
  });
});
