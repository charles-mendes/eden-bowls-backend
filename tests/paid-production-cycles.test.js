const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR, TIMEZONE_US } = require('../src/core/delivery-closed-days');
const { PaidCyclesService } = require('../src/services/paid-cycles.service');
const { CustomerDeliveriesService, buildDeliveryRead } = require('../src/services/customer-deliveries.service');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');
const { presentProductionQueueItem } = require('../src/core/production-queue-presenter');

const rows = buildSeedRows();
const br = (year, month, day, hour = 0) => wallTimeToUtc(year, month, day, hour, 0, 0, TIMEZONE_BR);
const us = (year, month, day, hour = 0) => wallTimeToUtc(year, month, day, hour, 0, 0, TIMEZONE_US);
const unix = (date) => Math.floor(date.getTime() / 1000);

function ledgerRow(overrides = {}) {
  return {
    id: 42,
    stripeSubscriptionId: 'sub_123',
    stripeAccount: 'br',
    currentPeriodEnd: br(2026, 2, 3, 14),
    subscriptionTermMonths: 3,
    planSelection: { catalog_pricing: { subtotal: 100, line_items: [{ quantity: 8 }] } },
    address: { country: 'BR' },
    shipping: { distance: 10 },
    ...overrides
  };
}

describe('a cycle enters production when its invoice is paid (3.12)', () => {
  function recorder() {
    const markPaid = jest.fn(async (input) => input);
    return { service: new PaidCyclesService({ productionRepository: { markPaid }, calendar: { listActive: async () => rows } }), markPaid };
  }

  test('a renewal paid on Saturday at 14:00 in Brazil prepares and delivers on Monday', async () => {
    const { service, markPaid } = recorder();
    const charge = br(2026, 1, 3, 14);
    await service.recordPaid({
      ledgerRow: ledgerRow(),
      subscription: { current_period_start: unix(charge) },
      invoice: { id: 'in_1', status_transitions: { paid_at: unix(charge) + 60 } }
    });
    expect(markPaid).toHaveBeenCalledWith({
      subscriptionId: 42,
      periodEnd: charge,
      paidAt: new Date((unix(charge) + 60) * 1000),
      invoiceId: 'in_1',
      preparationDay: '2026-01-05',
      deliveryDate: '2026-01-05'
    });
  });

  test('a past_due renewal paid late prepares on the first valid day at or after the payment', async () => {
    const { service, markPaid } = recorder();
    const failedRenewal = br(2026, 1, 3, 14);
    const paidLate = br(2026, 1, 7, 10);
    await service.recordPaid({
      ledgerRow: ledgerRow(),
      subscription: { current_period_start: unix(failedRenewal) },
      invoice: { id: 'in_1', status_transitions: { paid_at: unix(paidLate) } }
    });
    // Wednesday 10:00: Wednesday's midnight has passed, so Thursday 8 January.
    expect(markPaid).toHaveBeenCalledWith(expect.objectContaining({
      periodEnd: failedRenewal,
      preparationDay: '2026-01-08',
      deliveryDate: '2026-01-08'
    }));
  });

  test('a late United States payment recalculates pickup and delivery from the payment', async () => {
    const { service, markPaid } = recorder();
    await service.recordPaid({
      ledgerRow: ledgerRow({ stripeAccount: 'us', address: { country: 'US', business_days_in_transit: 1 } }),
      subscription: { current_period_start: unix(us(2026, 6, 1)) },
      invoice: { id: 'in_1', status_transitions: { paid_at: unix(us(2026, 6, 3, 9)) } }
    });
    // Paid Wednesday 3 June at 09:00: Thursday cannot ship (delivery would be Saturday), so Monday 8 June,
    // pickup Tuesday 9, delivery Wednesday 10.
    expect(markPaid).toHaveBeenCalledWith(expect.objectContaining({ preparationDay: '2026-06-08', deliveryDate: '2026-06-10' }));
  });

  test('the webhook records the paid cycle for a counted cycle invoice only', async () => {
    const recordPaid = jest.fn();
    const row = { id: 42, stripeSubscriptionId: 'sub_123', chargedDeliveries: 1, autoRenew: true };
    const webhook = new StripeWebhookService({
      ledgerRepository: {
        findByStripeSubscriptionId: jest.fn().mockResolvedValue(row),
        incrementChargedDeliveries: jest.fn().mockResolvedValue({ ...row, chargedDeliveries: 2 })
      },
      paidCycles: { recordPaid }
    });
    const subscription = { current_period_start: 1 };
    await webhook.recordChargedDelivery({ invoice: { id: 'in_2', billing_reason: 'subscription_cycle', subtotal: 100 }, subscriptionId: 'sub_123', subscription, billing: {} });
    expect(recordPaid).toHaveBeenCalledWith({ ledgerRow: { ...row, chargedDeliveries: 2 }, subscription, invoice: expect.objectContaining({ id: 'in_2' }), estimate: null });

    recordPaid.mockClear();
    await webhook.recordChargedDelivery({ invoice: { id: 'in_skip', billing_reason: 'subscription_update', subtotal: 0 }, subscriptionId: 'sub_123', subscription, billing: {} });
    expect(recordPaid).not.toHaveBeenCalled();
  });
});

describe('Meu Plano shows the paid delivery on its way (3.12)', () => {
  // The January delivery was paid late and is in production; the February renewal is the following delivery.
  const input = {
    id: 'sub_123',
    stripeSubscriptionId: 'sub_123',
    status: 'active',
    userId: 7,
    market: 'BR',
    termMonths: 3,
    chargedCount: 1,
    chargeAt: br(2026, 2, 3, 14),
    productionStatus: 'to_prepare',
    packsPerMonth: 8,
    subtotal: 100,
    transitDays: 0,
    paidCycle: { status: 'in_production', preparationDay: '2026-01-08', deliveryDate: '2026-01-08' },
    currentPaid: true
  };
  const now = br(2026, 1, 8, 9);

  test('the paid delivery is current and locked with its recalculated date; the actions move to the next renewal', () => {
    const read = buildDeliveryRead({ ...input, rows, now });
    expect(read.delivery).toMatchObject({ id: 'current', date: '2026-01-08', locked: true, actions: false, status: 'in_production', statusLabel: 'Em preparo' });
    expect(read.actionTarget).toMatchObject({ id: 'following', date: '2026-02-04' });
    expect(read.later.map((item) => item.deliveryDate)).toEqual(['2026-02-04', '2026-03-04']);
    expect(read.contractEnd).toBe('2026-03-04');
    // Skipping February: the renewals are 3 March and 3 April; 3 April 2026 is Good Friday, so Saturday 4 April.
    expect(read.contractEndIfSkip).toBe('2026-04-04');
  });

  test('skipping the following delivery moves its charge in Stripe at once', async () => {
    const setTrialEnd = jest.fn().mockResolvedValue({});
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      subscriptions: { findForUser: jest.fn().mockResolvedValue({ ...input }), recordPendingChanges: jest.fn(), recordChargeMoved: jest.fn() },
      stripeAccounts: { get: () => ({ setTrialEnd }) },
      now: () => now
    });
    await service.skip({ ...input }, 7, { deliveryId: 'following' });
    expect(setTrialEnd).toHaveBeenCalledWith(expect.objectContaining({ subscriptionId: 'sub_123', proration_behavior: 'none' }));
  });

  test('after the last contracted delivery is paid there is no following delivery to change', () => {
    const read = buildDeliveryRead({ ...input, chargedCount: 3, rows, now });
    expect(read.delivery.date).toBe('2026-01-08');
    expect(read.actionTarget).toBeNull();
    expect(read.later).toEqual([]);
    expect(read.contractEnd).toBe('2026-01-08');
  });
});

describe('queue labels (3.12)', () => {
  test('an unpaid cycle reads awaiting payment, a failed one late payment, a paid one has no payment label', () => {
    const base = { id: 1, currentPeriodEnd: '2026-10-20T17:00:00.000Z', cyclePeriodEnd: '2026-09-20T17:00:00.000Z' };
    const now = new Date('2026-09-20T15:00:00.000Z');
    expect(presentProductionQueueItem({ ...base, paymentState: 'awaiting_payment' }, { now }).paymentLabel).toBe('Aguardando pagamento');
    expect(presentProductionQueueItem({ ...base, paymentState: 'past_due' }, { now }).paymentLabel).toBe('Pagamento atrasado');
    const paid = presentProductionQueueItem({ ...base, paymentState: 'paid', dueAt: '2026-09-21T12:00:00.000Z', preparationDay: '2026-09-21' }, { now });
    expect(paid.paymentLabel).toBeNull();
    // The admin sends back the cycle key, and the paid cycle is due on its preparation day.
    expect(paid.currentPeriodEnd).toBe('2026-09-20T17:00:00.000Z');
    expect(paid.dueBucket).toBe('tomorrow');
  });
});

describe('MySQL datetime strings (3.12)', () => {
  const { toMysqlDateTime } = require('../src/core/stripe-subscription-map');
  test('a MySQL DATETIME string is read as UTC, so re-reading a stored cycle key does not shift it', () => {
    expect(toMysqlDateTime('2026-09-20 17:00:00')).toBe('2026-09-20 17:00:00');
    expect(toMysqlDateTime(toMysqlDateTime(new Date('2026-09-20T17:00:00.000Z')))).toBe('2026-09-20 17:00:00');
  });
});
