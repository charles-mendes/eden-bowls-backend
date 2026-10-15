const request = require('supertest');
const { createApp } = require('../src/app');
const { issueJwtToken } = require('../src/core/jwt-token');
const { StripeBillingClient } = require('../src/infrastructure/stripe/stripe-billing-client');
const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');

describe('customer delivery routes', () => {
  const corsOrigins = ['http://localhost:5173'];
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };

  function token(userId) {
    return issueJwtToken(
      { data: { user: { id: userId } } },
      { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) }
    );
  }

  function appWith(service) {
    return createApp({
      customerDeliveriesService: service,
      corsOrigins,
      jwt
    });
  }

  test('rejects skip, reschedule, and pack commit for another customer', async () => {
    const customerDeliveriesService = {
      loadSubscription: jest.fn().mockRejectedValue(Object.assign(new Error('Subscription not found.'), {
        statusCode: 404,
        details: { code: 'not_found' }
      }))
    };
    const { HttpError } = require('../src/core/http-error');
    customerDeliveriesService.loadSubscription.mockRejectedValue(
      new HttpError(404, 'Subscription not found.', { code: 'not_found' })
    );
    const app = appWith(customerDeliveriesService);
    const headers = { Authorization: `Bearer ${token(9)}` };
    for (const path of ['skip', 'reschedule', 'packs']) {
      const response = await request(app)
        .post(`/api/v1/subscriptions/sub_other/deliveries/current/${path}`)
        .set(headers)
        .send({});
      expect(response.status).toBe(404);
    }
  });

  test('rejects a locked delivery', async () => {
    const { HttpError } = require('../src/core/http-error');
    const customerDeliveriesService = {
      loadSubscription: jest.fn().mockResolvedValue({ id: 'sub_123', userId: 7 }),
      skip: jest.fn().mockRejectedValue(new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' })),
      reschedule: jest.fn().mockRejectedValue(new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' })),
      commitPacks: jest.fn().mockRejectedValue(new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' }))
    };
    const app = appWith(customerDeliveriesService);
    const headers = { Authorization: `Bearer ${token(7)}` };
    for (const path of ['skip', 'reschedule', 'packs']) {
      const response = await request(app)
        .post(`/api/v1/subscriptions/sub_123/deliveries/current/${path}`)
        .set(headers)
        .send({});
      expect(response.status).toBe(409);
    }
  });

  test('skip and reschedule pass the delivery id and the chosen date to the service', async () => {
    const customerDeliveriesService = {
      loadSubscription: jest.fn().mockResolvedValue({ id: 'sub_123', userId: 7 }),
      skip: jest.fn().mockResolvedValue({ stripeChanged: true }),
      reschedule: jest.fn().mockResolvedValue({ stripeChanged: true })
    };
    const app = appWith(customerDeliveriesService);
    const headers = { Authorization: `Bearer ${token(7)}` };

    const skipped = await request(app)
      .post('/api/v1/subscriptions/sub_123/deliveries/current/skip')
      .set(headers)
      .send({});
    expect(skipped.status).toBe(200);
    expect(customerDeliveriesService.skip).toHaveBeenCalledWith({ id: 'sub_123', userId: 7 }, 7, { deliveryId: 'current' });

    const moved = await request(app)
      .post('/api/v1/subscriptions/sub_123/deliveries/current/reschedule')
      .set(headers)
      .send({ date: '2026-02-12' });
    expect(moved.status).toBe(200);
    expect(customerDeliveriesService.reschedule).toHaveBeenCalledWith({ id: 'sub_123', userId: 7 }, 7, { deliveryId: 'current', date: '2026-02-12' });
  });

  test('wired like index.js, the deliveries read answers from the ledger instead of 503', async () => {
    const { parseEnv } = require('../src/config/env');
    const { createShippingQuoteServices } = require('../src/config/shipping-quote-services');
    const { buildSeedRows } = require('../src/core/delivery-closed-days');
    const chargeAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const row = {
      id: 41,
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeAccount: 'us',
      status: 'active',
      currentPeriodEnd: chargeAt,
      cancelAtPeriodEnd: false,
      subscriptionTermMonths: 3,
      planSelection: { catalog_pricing: { subtotal: 96, line_items: [{ quantity: 6 }] } },
      shipping: { cost: 12.9, delivery_days: 1 },
      address: { country: 'US', postal_code: '94105', business_days_in_transit: 1 }
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn(async (userId, subscriptionId) => (
        String(userId) === '7' && subscriptionId === 'sub_123' ? row : null
      )),
      upsert: jest.fn()
    };
    const { customerDeliveriesService } = createShippingQuoteServices({
      env: parseEnv({ NODE_ENV: 'development', EDEN_RUNTIME: 'local', SHIPPING_QUOTE_SECRET: 'wiring-secret' }),
      logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn() },
      shippingSettings: { us: { enabled: true, quote_mode: 'fixed', cost: 12.9 }, br: { enabled: false, rule: {} } },
      deliveryCalendar: { listActive: async () => buildSeedRows() },
      stripeAccounts: {
        get: () => ({
          listPaidInvoicesForSubscription: async () => [
            { status: 'paid', amount_paid: 10890, billing_reason: 'subscription_create' }
          ]
        })
      },
      ledgerRepository,
      productionRepository: { findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(null) }
    });
    const app = appWith(customerDeliveriesService);

    const response = await request(app)
      .get('/api/v1/subscriptions/sub_123/deliveries')
      .set({ Authorization: `Bearer ${token(7)}` });
    expect(response.status).toBe(200);
    expect(response.body.delivery).toMatchObject({ packs: 6, price: 96, actions: true });
    expect(response.body.upsCalls).toBe(0);

    const stranger = await request(app)
      .get('/api/v1/subscriptions/sub_123/deliveries')
      .set({ Authorization: `Bearer ${token(9)}` });
    expect(stranger.status).toBe(404);
  });

  test('a US client and a BR client do not share one key', () => {
    const us = new StripeBillingClient({ account: 'us', secretKey: 'sk_test_us_separate', client: { id: 'us' } });
    const br = new StripeBillingClient({ account: 'br', secretKey: 'sk_test_br_separate', client: { id: 'br' } });
    const accounts = new StripeAccounts({ us, br, brEnabled: true });
    expect(accounts.get('us')).not.toBe(accounts.get('br'));
    expect(accounts.get('us').secretKey).not.toBe(accounts.get('br').secretKey);
  });
});
