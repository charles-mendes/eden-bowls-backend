const { parseEnv } = require('../src/config/env');
const { createShippingQuoteServices } = require('../src/config/shipping-quote-services');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');
const { buildSeedRows, wallTimeToUtc, TIMEZONE_US } = require('../src/core/delivery-closed-days');
const { normalizeShippingPayload } = require('../src/services/onboarding-shipping-select.service');

function usFixedSettings() {
  return {
    us: {
      enabled: true,
      quote_mode: 'fixed',
      fallback_enabled: true,
      cost: 12.9,
      label: 'Ground',
      carrier: 'UPS',
      delivery: '1 business day'
    },
    br: { enabled: false, rule: { per_km: 0 } }
  };
}

function buildLikeIndex() {
  const env = parseEnv({ NODE_ENV: 'development', EDEN_RUNTIME: 'local', SHIPPING_QUOTE_SECRET: 'wiring-secret' });
  return createShippingQuoteServices({
    env,
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
    shippingSettings: usFixedSettings(),
    deliveryCalendar: { listActive: async () => buildSeedRows() },
    stripeAccounts: null
  });
}

function savedLikeTheStore(quote) {
  return normalizeShippingPayload({
    rate_id: quote.rate_id,
    method_id: quote.method_id,
    cost: quote.shipping,
    total: quote.shipping,
    delivery_days: Number(quote.delivery_days || 0),
    quoted_at: quote.quoted_at,
    zipcode: quote.destination.zipcode,
    quote_token: quote.quote_token
  });
}

const usSubscription = {
  userId: 7,
  market: 'US',
  termMonths: 3,
  chargedCount: 1,
  autoRenew: true,
  chargeAt: wallTimeToUtc(2026, 1, 5, 14, 0, 0, TIMEZONE_US),
  transitDays: 1
};

describe('shipping quote services wired like index.js', () => {
  test('the plan address change shares the signer handed to checkout', () => {
    const { shippingQuoteSigner, shippingService, customerDeliveriesService } = buildLikeIndex();
    expect(shippingService.quoteSigner).toBe(shippingQuoteSigner);
    expect(customerDeliveriesService.shippingQuoteSigner).toBe(shippingQuoteSigner);
  });

  test('an address change with a valid quote from the shipping endpoint is accepted', async () => {
    const { shippingService, customerDeliveriesService } = buildLikeIndex();
    const { data } = await shippingService.calculateUs({ zipCode: '94105' });

    const changed = await customerDeliveriesService.applyAddressChange(usSubscription, {
      zipcode: '94105',
      shipping: savedLikeTheStore(data)
    });

    expect(changed.chargeAt).toBe(usSubscription.chargeAt);
    expect(changed.stripeChanged).toBe(false);
  });

  test('a quote signed elsewhere is refused by the same wiring', async () => {
    const { customerDeliveriesService } = buildLikeIndex();
    const stranger = new ShippingQuoteSigner({ secret: 'another-secret' });
    await expect(customerDeliveriesService.applyAddressChange(usSubscription, {
      zipcode: '94105',
      shipping: {
        cost: 12.9,
        delivery_days: 1,
        quote_token: stranger.sign({ country: 'US', zipcode: '94105', cost: 12.9, deliveryDays: 1 })
      }
    })).rejects.toMatchObject({ details: { code: 'delivery_area_unverified' } });
  });
});
