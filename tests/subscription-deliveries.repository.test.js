const {
  SubscriptionDeliveriesRepository,
  contractChargedCount,
  mapDeliverySubscription
} = require('../src/infrastructure/repositories/subscription-deliveries.repository');
const { CustomerDeliveriesService } = require('../src/services/customer-deliveries.service');
const { buildSeedRows, wallTimeToUtc, TIMEZONE_US } = require('../src/core/delivery-closed-days');

const CHARGE_AT = wallTimeToUtc(2026, 1, 5, 14, 0, 0, TIMEZONE_US);

function ledgerRow(overrides = {}) {
  return {
    id: 41,
    userId: 7,
    stripeSubscriptionId: 'sub_123',
    stripeAccount: 'us',
    status: 'active',
    currentPeriodEnd: CHARGE_AT,
    cancelAtPeriodEnd: false,
    subscriptionTermMonths: 3,
    planSelection: {
      subscription_term_months: 3,
      catalog_pricing: {
        subtotal: 96,
        currency: 'USD',
        line_items: [{ quantity: 4 }, { quantity: 2 }]
      }
    },
    shipping: { cost: 12.9, delivery_days: 1 },
    address: { country: 'US', postal_code: '94105-1234', business_days_in_transit: 1 },
    ...overrides
  };
}

function stripeWithInvoices(invoices) {
  const billing = { listPaidInvoicesForSubscription: jest.fn().mockResolvedValue(invoices) };
  return { billing, accounts: { get: jest.fn().mockReturnValue(billing) } };
}

describe('contractChargedCount', () => {
  test('counts inside the current contract when renewal is on', () => {
    expect(contractChargedCount(1, 3, true)).toBe(1);
    expect(contractChargedCount(3, 3, true)).toBe(0);
    expect(contractChargedCount(4, 3, true)).toBe(1);
  });

  test('a finished contract stays finished when renewal is off', () => {
    expect(contractChargedCount(0, 3, false)).toBe(0);
    expect(contractChargedCount(2, 3, false)).toBe(2);
    expect(contractChargedCount(3, 3, false)).toBe(3);
  });

  test('renewal turned off inside a rolled contract counts only that contract', () => {
    expect(contractChargedCount(5, 3, false)).toBe(2);
    expect(contractChargedCount(6, 3, false)).toBe(3);
  });

  test('stays unknown when the paid count is unknown', () => {
    expect(contractChargedCount(null, 3, true)).toBeNull();
  });
});

describe('mapDeliverySubscription', () => {
  test('maps a US ledger row to the deliveries read input', () => {
    const mapped = mapDeliverySubscription(ledgerRow(), { cycle: { status: 'in_production' }, paidDeliveries: 1 });
    expect(mapped).toMatchObject({
      id: 'sub_123',
      ledgerId: 41,
      userId: 7,
      market: 'US',
      zipcode: '941051234',
      termMonths: 3,
      autoRenew: true,
      chargedCount: 1,
      transitDays: 1,
      distanceKm: null,
      productionStatus: 'in_production',
      packsPerMonth: 6,
      subtotal: 96
    });
    expect(mapped.chargeAt.getTime()).toBe(CHARGE_AT.getTime());
  });

  test('maps a Brazilian row with its route distance and no transit', () => {
    const mapped = mapDeliverySubscription(ledgerRow({
      stripeAccount: 'br',
      shipping: { cost: 20, distance: 12.4 },
      address: { country: 'BR', zipcode: '01310-100' }
    }));
    expect(mapped).toMatchObject({ market: 'BR', zipcode: '01310100', distanceKm: 12.4, transitDays: null });
  });
});

describe('SubscriptionDeliveriesRepository', () => {
  function buildRepo({
    row = ledgerRow(),
    invoices = [{ status: 'paid', amount_paid: 10890, billing_reason: 'subscription_create' }],
    cycle = null,
    shippingService = null
  } = {}) {
    const stripe = stripeWithInvoices(invoices);
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(row),
      upsert: jest.fn().mockResolvedValue(row)
    };
    const productionRepository = { findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(cycle) };
    const repository = new SubscriptionDeliveriesRepository({
      ledgerRepository,
      productionRepository,
      stripeAccounts: stripe.accounts,
      shippingService,
      logger: { warn: jest.fn(), error: jest.fn() }
    });
    return { repository, ledgerRepository, productionRepository, stripe };
  }

  test('reads the cycle for the next charge and counts only paid deliveries', async () => {
    const { repository, productionRepository } = buildRepo({
      invoices: [
        { status: 'paid', amount_paid: 10890, billing_reason: 'subscription_create' },
        { status: 'paid', amount_paid: 10890, billing_reason: 'subscription_cycle' },
        { status: 'paid', amount_paid: 0, billing_reason: 'subscription_cycle' },
        { status: 'open', amount_paid: 0, billing_reason: 'subscription_cycle' }
      ],
      cycle: { status: 'to_prepare' }
    });

    const subscription = await repository.findForUser('sub_123', 7);

    expect(productionRepository.findBySubscriptionAndPeriodEnd).toHaveBeenCalledWith(41, CHARGE_AT);
    expect(subscription.chargedCount).toBe(2);
    expect(subscription.productionStatus).toBe('to_prepare');
  });

  test('a paid proration or adjustment invoice does not add a charged delivery', async () => {
    const { repository } = buildRepo({
      invoices: [
        { status: 'paid', amount_paid: 10890, billing_reason: 'subscription_create' },
        { status: 'paid', amount_paid: 3200, billing_reason: 'subscription_update' },
        { status: 'paid', amount_paid: 1500, billing_reason: 'manual' }
      ]
    });

    const subscription = await repository.findForUser('sub_123', 7);
    expect(subscription.chargedCount).toBe(1);
  });

  test('uses the charged count on the ledger and does not list Stripe invoices', async () => {
    const { repository, stripe } = buildRepo({ row: ledgerRow({ chargedDeliveries: 1 }) });
    const subscription = await repository.findForUser('sub_123', 7);
    expect(subscription.chargedCount).toBe(1);
    expect(stripe.billing.listPaidInvoicesForSubscription).not.toHaveBeenCalled();
  });

  test('the saved renewal preference wins over cancel_at_period_end', () => {
    const mapped = mapDeliverySubscription(ledgerRow({ autoRenew: false, cancelAtPeriodEnd: false }), { paidDeliveries: 4 });
    expect(mapped.autoRenew).toBe(false);
    expect(mapped.chargedCount).toBe(1);
    expect(mapDeliverySubscription(ledgerRow({ autoRenew: null, cancelAtPeriodEnd: true })).autoRenew).toBe(false);
  });

  test('a moved charge writes the trialing status and the new period end to the ledger', async () => {
    const { repository, ledgerRepository } = buildRepo();
    const trialEnd = Math.floor(CHARGE_AT.getTime() / 1000) + 30 * 24 * 60 * 60;
    await repository.recordChargeMoved({ stripeSubscriptionId: 'sub_123' }, {
      id: 'sub_123',
      status: 'trialing',
      trial_end: trialEnd,
      items: { data: [{ current_period_start: trialEnd - 100, current_period_end: trialEnd }] }
    });
    expect(ledgerRepository.upsert).toHaveBeenCalledWith({
      stripeSubscriptionId: 'sub_123',
      status: 'trialing',
      currentPeriodStart: trialEnd - 100,
      currentPeriodEnd: trialEnd
    });
  });

  test('returns null for a subscription the customer does not own', async () => {
    const { repository } = buildRepo({ row: null });
    await expect(repository.findForUser('sub_other', 7)).resolves.toBeNull();
  });

  test('logs the Stripe failure and leaves the charged count unknown instead of a default', async () => {
    const { repository, stripe } = buildRepo();
    stripe.billing.listPaidInvoicesForSubscription.mockRejectedValue(new Error('stripe down'));
    const subscription = await repository.findForUser('sub_123', 7);
    expect(subscription.chargedCount).toBeNull();
    expect(repository.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: 'sub_123', message: 'stripe down' }),
      expect.stringContaining('omits the contract end')
    );
  });

  test('a Stripe failure omits the contract end and the later deliveries without breaking the read', async () => {
    const { repository, stripe } = buildRepo();
    stripe.billing.listPaidInvoicesForSubscription.mockRejectedValue(new Error('stripe down'));
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => buildSeedRows() },
      subscriptions: repository,
      ups: repository,
      now: () => new Date(CHARGE_AT.getTime() - 3 * 24 * 60 * 60 * 1000)
    });

    const read = await service.read(await service.loadSubscription('sub_123', 7), 7);

    expect(read.contractEnd).toBeNull();
    expect(read.contractEndIfSkip).toBeNull();
    expect(read.later).toEqual([]);
    expect(read.delivery.date).toBeTruthy();
    expect(read.delivery).toMatchObject({ packs: 6, price: 96, actions: true });
    expect(read.actionTarget).toMatchObject({ id: 'current' });
  });

  test('stores a quoted transit on the saved address', async () => {
    const shippingService = { calculateUs: jest.fn().mockResolvedValue({ data: { delivery_days: 1 } }) };
    const row = ledgerRow({ address: { country: 'US', postal_code: '94105' }, shipping: { cost: 12.9 } });
    const { repository, ledgerRepository } = buildRepo({ row, shippingService });
    const subscription = await repository.findForUser('sub_123', 7);

    expect(subscription.transitDays).toBeNull();
    await expect(repository.quoteTransitDays(subscription)).resolves.toBe(1);
    await repository.storeTransitDays(subscription, 1);
    expect(shippingService.calculateUs).toHaveBeenCalledWith({ zipCode: '94105' });
    expect(ledgerRepository.upsert).toHaveBeenCalledWith({
      stripeSubscriptionId: 'sub_123',
      address: { country: 'US', postal_code: '94105', business_days_in_transit: 1 }
    });
  });

  test('a later deliveries read uses the transit saved with the address and does not call UPS', async () => {
    const shippingService = { calculateUs: jest.fn() };
    const { repository } = buildRepo({ shippingService });
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => buildSeedRows() },
      subscriptions: repository,
      ups: repository,
      now: () => new Date(CHARGE_AT.getTime() - 3 * 24 * 60 * 60 * 1000)
    });

    const subscription = await service.loadSubscription('sub_123', 7);
    const read = await service.read(subscription, 7);

    expect(shippingService.calculateUs).not.toHaveBeenCalled();
    expect(read.upsCalls).toBe(0);
    expect(read.delivery.date).toBeTruthy();
    expect(read.delivery.actions).toBe(true);
    expect(read.later).toHaveLength(1);
    expect(read.later[0]).toMatchObject({ packs: 6, price: 96 });
  });

  test('a locked delivery hands the actions to the following delivery with its own deadline', async () => {
    const { repository } = buildRepo({ cycle: { status: 'in_production' } });
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => buildSeedRows() },
      subscriptions: repository,
      ups: repository,
      now: () => new Date(CHARGE_AT.getTime() - 3 * 24 * 60 * 60 * 1000)
    });

    const read = await service.read(await service.loadSubscription('sub_123', 7), 7);

    expect(read.delivery.locked).toBe(true);
    expect(read.delivery.actions).toBe(false);
    expect(read.actionTarget).toMatchObject({ id: 'following', date: read.later[0].deliveryDate, packs: 6 });
    expect(new Date(read.actionTarget.editableUntil).getTime()).toBeGreaterThan(new Date(read.delivery.editableUntil).getTime());
  });
});
