const request = require('supertest');
const { createApp } = require('../src/app');
const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR, TIMEZONE_US } = require('../src/core/delivery-closed-days');
const { DeliveryEstimator } = require('../src/services/delivery-estimator.service');
const { PaidCyclesService } = require('../src/services/paid-cycles.service');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');
const { buildOrderConfirmedEmail } = require('../src/core/email/transactional-emails');
const { formatDeliveryDay } = require('../src/infrastructure/mailers/transactional-mailer');

const estimator = new DeliveryEstimator({ calendar: { listActive: async () => buildSeedRows() } });
const unix = (date) => Math.floor(date.getTime() / 1000);

// Wednesday 7 October 2026 at 15:00 in Sao Paulo: Wednesday's midnight has passed, so Thursday 8 October.
const BR_PURCHASE = wallTimeToUtc(2026, 10, 7, 15, 0, 0, TIMEZONE_BR);
// Thursday 8 October 2026 at 10:00 in New York, 1 transit day: Friday cannot ship (pickup Saturday), so
// preparation Monday 12 October (Columbus Day is a normal UPS day), pickup Tuesday 13, delivery Wednesday 14.
const US_PURCHASE = wallTimeToUtc(2026, 10, 8, 10, 0, 0, TIMEZONE_US);

const MARKETS = [
  {
    name: 'BR, bought on a Wednesday',
    query: { country: 'BR' },
    at: BR_PURCHASE,
    ledger: { stripeAccount: 'br', address: { country: 'BR' }, shipping: { distance: 10 } },
    expected: { preparationDay: '2026-10-08', deliveryDate: '2026-10-08' }
  },
  {
    name: 'US, bought on a Thursday',
    query: { country: 'US', transit_days: 1 },
    at: US_PURCHASE,
    ledger: { stripeAccount: 'us', address: { country: 'US', business_days_in_transit: 1 }, shipping: { delivery_days: 1 } },
    expected: { preparationDay: '2026-10-12', deliveryDate: '2026-10-14' }
  }
];

describe('first delivery estimate (3.14)', () => {
  test.each(MARKETS)('$name: the estimate follows the queue rule', async ({ query, at, expected }) => {
    await expect(estimator.estimate({ market: query.country, at, transitDays: query.transit_days || 0 })).resolves.toEqual(expected);
  });

  test.each(MARKETS)('$name: checkout, the confirmation email, and the queue give the same date', async ({ query, at, ledger, expected }) => {
    // Checkout: the estimate projected from now, here the purchase moment.
    const app = createApp({ deliveryEstimator: estimator, now: () => at, corsOrigins: ['http://localhost:5173'] });
    const checkout = await request(app).get('/api/v1/onboarding/delivery-estimate').query(query);
    expect(checkout.status).toBe(200);
    expect(checkout.body.data).toMatchObject({ available: true, preparation_day: expected.preparationDay, delivery_date: expected.deliveryDate });

    // Payment at that moment: the webhook estimates once and hands the same result to the email and the cycle.
    const row = { id: 42, userId: 7, stripeSubscriptionId: 'sub_first', subscriptionTermMonths: 3, chargedDeliveries: 0, autoRenew: true, ...ledger };
    const markPaid = jest.fn(async (input) => input);
    const notifyOrderConfirmed = jest.fn().mockResolvedValue({});
    const webhook = new StripeWebhookService({
      ledgerRepository: {
        findByStripeSubscriptionId: jest.fn().mockResolvedValue(row),
        incrementChargedDeliveries: jest.fn().mockResolvedValue({ ...row, chargedDeliveries: 1 })
      },
      transactionalMailer: { notifyOrderConfirmed, notifyAdminNewSubscription: jest.fn() },
      paidCycles: new PaidCyclesService({ productionRepository: { markPaid }, estimator })
    });
    const invoice = { id: 'in_first', billing_reason: 'subscription_create', subtotal: 9600, status_transitions: { paid_at: unix(at) } };
    const delivery = await webhook.estimateDelivery(invoice, 'sub_first');
    await webhook.notifyFirstCycleMail({ invoice, subscriptionId: 'sub_first', promotedPending: false, delivery });
    await webhook.recordChargedDelivery({ invoice, subscriptionId: 'sub_first', subscription: { current_period_start: unix(at) }, billing: {}, delivery });

    expect(notifyOrderConfirmed).toHaveBeenCalledWith(expect.objectContaining({ firstDeliveryDate: expected.deliveryDate }));
    expect(markPaid).toHaveBeenCalledWith(expect.objectContaining({
      preparationDay: expected.preparationDay,
      deliveryDate: expected.deliveryDate
    }));
  });

  test('the checkout estimate refuses an unknown country and marks a US transit above the limit unavailable', async () => {
    const app = createApp({ deliveryEstimator: estimator, now: () => US_PURCHASE, corsOrigins: ['http://localhost:5173'] });
    expect((await request(app).get('/api/v1/onboarding/delivery-estimate').query({ country: 'AR' })).status).toBe(422);
    expect((await request(app).get('/api/v1/onboarding/delivery-estimate').query({ country: 'US' })).status).toBe(422);
    const far = await request(app).get('/api/v1/onboarding/delivery-estimate').query({ country: 'US', transit_days: 2 });
    expect(far.body.data).toEqual({ country: 'US', available: false });
  });
});

describe('order confirmation names the first delivery (3.14)', () => {
  test('pt-BR and en-US say the planned date instead of "already being prepared"', () => {
    const ptLabel = formatDeliveryDay('2026-10-08', 'pt-BR');
    const enLabel = formatDeliveryDay('2026-10-08', 'en-US');
    expect(ptLabel).toBe('quinta-feira, 8 de outubro');
    expect(enLabel).toBe('Thursday, October 8');

    const pt = buildOrderConfirmedEmail({ petName: 'Luna', firstDeliveryLabel: ptLabel, locale: 'pt-BR' });
    expect(pt.text).toContain('A primeira entrega está prevista para quinta-feira, 8 de outubro.');
    expect(pt.text).not.toContain('já começou a preparar');
    expect(pt.html).toContain('Primeira entrega');

    const en = buildOrderConfirmedEmail({ petName: 'Luna', firstDeliveryLabel: enLabel, locale: 'en-US' });
    expect(en.text).toContain('Your first delivery is planned for Thursday, October 8.');
    expect(en.text).not.toContain('already started preparing');
  });
});
