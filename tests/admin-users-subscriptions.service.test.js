const { AdminUsersService } = require('../src/services/admin-users.service');
const { permissionsForRoles } = require('../src/core/admin-roles');

const user = { id: '8', email: 'ana@example.com', profileMarket: 'BR', storedRoles: [], roles: [] };

function ledgerRow(extra = {}) {
  return {
    id: 11,
    stripeSubscriptionId: 'sub_br',
    stripeAccount: 'br',
    status: 'active',
    currentPeriodEnd: '2026-12-01 00:00:00',
    cancelAtPeriodEnd: false,
    planLabel: 'Plano 2 pets',
    createdAt: '2026-09-01 10:00:00',
    subscriptionTermMonths: 6,
    chargedDeliveries: 2,
    autoRenew: true,
    paymentMethodBrand: 'visa',
    paymentMethodLast4: '4242',
    shipping: { label: 'Entrega local', cost: 25, total: 30, currency: 'brl', distance: 8.2, quoteToken: 'tok_secret' },
    ...extra
  };
}

function cycleView(extra = {}) {
  return {
    invoiceId: 'in_br',
    preparationDay: '2026-11-08',
    productionStatus: 'ready',
    productionNote: 'sem frango',
    deliveryDate: '2026-11-10',
    paidAt: '2026-11-01T12:00:00.000Z',
    upsShipment: null,
    courierDelivery: null,
    ...extra
  };
}

function build({ rows = [ledgerRow()], views = { 11: cycleView() }, notes = [] } = {}) {
  const usersRepository = { findUserById: jest.fn().mockResolvedValue(user), findFiscalData: jest.fn().mockResolvedValue(null) };
  const paidCyclesService = {
    latestBySubscriptions: jest.fn(async (list) => new Map(list.map((row) => [String(row.id), views[row.id] || null])))
  };
  const nfeRepository = { listByStripeInvoices: jest.fn(async () => notes) };
  const logger = { warn: jest.fn() };
  // 2026-11-09 15:00 UTC: two days after the fixture cycle was paid (seconds, as nowProvider returns).
  const nowProvider = () => Date.parse('2026-11-09T15:00:00.000Z') / 1000;
  const service = new AdminUsersService({ usersRepository, paidCyclesService, nfeRepository, logger, nowProvider, adminEmails: [] });
  service.assertCustomerInScope = jest.fn();
  service.scopedSubscriptions = jest.fn().mockResolvedValue(rows);
  return { service, paidCyclesService, nfeRepository, logger };
}

async function subscriptionsFor(options, permissions) {
  const { service } = build(options);
  return (await service.getById('8', { permissions })).subscriptions;
}

describe('customer detail subscriptions: contract data', () => {
  test('carries market, start, term, charged deliveries and auto renew', async () => {
    const [item] = await subscriptionsFor({}, ['users.read']);
    expect(item).toMatchObject({
      stripeAccount: 'br',
      createdAt: '2026-09-01 10:00:00',
      subscriptionTermMonths: 6,
      chargedDeliveries: 2,
      autoRenew: true
    });
  });

  test('an old subscription without a term has nulls', async () => {
    const [item] = await subscriptionsFor({
      rows: [ledgerRow({ subscriptionTermMonths: null, chargedDeliveries: null, autoRenew: null, createdAt: null })]
    }, ['users.read']);
    expect(item).toMatchObject({ subscriptionTermMonths: null, chargedDeliveries: null, autoRenew: null, createdAt: null });
  });
});

describe('customer detail subscriptions: payment and checkout freight', () => {
  test('billing readers get the card and the checkout freight, without the quote token or distance', async () => {
    const [item] = await subscriptionsFor({}, ['users.read', 'billing.subscribers.read']);
    expect(item.paymentMethod).toEqual({ brand: 'visa', last4: '4242' });
    expect(item.checkoutShipping).toEqual({ label: 'Entrega local', amount: 25, currency: 'BRL' });
  });

  test('freight falls back to the total and is null without a snapshot', async () => {
    const [withTotal] = await subscriptionsFor({ rows: [ledgerRow({ shipping: { total: 30 } })] }, ['billing.subscribers.read']);
    expect(withTotal.checkoutShipping).toEqual({ label: null, amount: 30, currency: 'BRL' });
    const [without] = await subscriptionsFor({ rows: [ledgerRow({ shipping: null })] }, ['billing.subscribers.read']);
    expect(without.checkoutShipping).toBeNull();
  });

  test('a synthetic actor without billing access gets neither key (guards a future role split)', async () => {
    const [item] = await subscriptionsFor({}, ['users.read']);
    expect(item).not.toHaveProperty('paymentMethod');
    expect(item).not.toHaveProperty('checkoutShipping');
  });
});

describe('customer detail subscriptions: latest cycle', () => {
  test.each(['operator', 'readonly', 'admin'])('the real %s role gets the full payload', async (role) => {
    const [item] = await subscriptionsFor({
      views: { 11: cycleView({ courierDelivery: { id: 5, status: 'delivered', outForDeliveryAt: null, deliveredAt: '2026-11-10T15:00:00.000Z', failedAt: null } }) },
      notes: [{ id: 3, stripeInvoiceId: 'in_br', nfeNumber: '123', nfeSeries: '1', status: 'authorized', lastError: null, emailStatus: 'sent' }]
    }, permissionsForRoles([role]));
    expect(item.paymentMethod).toBeDefined();
    expect(item.latestCycle).toEqual({
      invoiceId: 'in_br',
      paidAt: '2026-11-01T12:00:00.000Z',
      preparationDay: '2026-11-08',
      deliveryDate: '2026-11-10',
      production: { status: 'ready', note: 'sem frango' },
      delivery: { kind: 'courier', id: 5, status: 'delivered', outForDeliveryAt: null, deliveredAt: '2026-11-10T15:00:00.000Z', failedAt: null },
      nfe: { id: 3, number: '123', series: '1', status: 'authorized', lastError: null, emailStatus: 'sent' }
    });
    expect(item).not.toHaveProperty('latestCycleUnavailable');
  });

  test('without any operation permission there is no latestCycle and nothing is read', async () => {
    const { service, paidCyclesService } = build();
    const [item] = (await service.getById('8', { permissions: ['users.read'] })).subscriptions;
    expect(item).not.toHaveProperty('latestCycle');
    expect(paidCyclesService.latestBySubscriptions).not.toHaveBeenCalled();
  });

  test('production.read alone: production only (synthetic actor)', async () => {
    const [item] = await subscriptionsFor({}, ['production.read']);
    expect(item.latestCycle.production).toEqual({ status: 'ready', note: 'sem frango' });
    expect(item.latestCycle).not.toHaveProperty('delivery');
    expect(item.latestCycle).not.toHaveProperty('nfe');
  });

  test('shipping.read alone: delivery only (synthetic actor)', async () => {
    const [item] = await subscriptionsFor({}, ['shipping.read']);
    expect(item.latestCycle.delivery).toBeNull();
    expect(item.latestCycle).not.toHaveProperty('production');
    expect(item.latestCycle).not.toHaveProperty('nfe');
  });

  test('nfe.read alone: NF-e only (synthetic actor)', async () => {
    const { service, nfeRepository } = build();
    const [item] = (await service.getById('8', { permissions: ['nfe.read'] })).subscriptions;
    expect(nfeRepository.listByStripeInvoices).toHaveBeenCalledWith([{ stripeAccount: 'br', stripeInvoiceId: 'in_br' }]);
    expect(item.latestCycle.nfe).toBeNull();
    expect(item.latestCycle).not.toHaveProperty('production');
    expect(item.latestCycle).not.toHaveProperty('delivery');
  });

  test('a subscription without a paid cycle has latestCycle null', async () => {
    const [item] = await subscriptionsFor({ views: {} }, permissionsForRoles(['operator']));
    expect(item.latestCycle).toBeNull();
  });

  test('courier wins over UPS on the same invoice', async () => {
    const [item] = await subscriptionsFor({
      views: { 11: cycleView({
        upsShipment: { id: 2, status: 'label_created', trackingNumber: '1Z999' },
        courierDelivery: { id: 5, status: 'out_for_delivery', outForDeliveryAt: '2026-11-10T12:00:00.000Z', deliveredAt: null, failedAt: null }
      }) }
    }, ['shipping.read']);
    expect(item.latestCycle.delivery.kind).toBe('courier');
  });

  test('a US cycle with a label shows UPS and has no nfe key', async () => {
    const { service, nfeRepository } = build({
      rows: [ledgerRow({ id: 12, stripeAccount: 'us' })],
      views: { 12: cycleView({ invoiceId: 'in_us', upsShipment: { id: 2, status: 'label_created', trackingNumber: '1Z999' } }) }
    });
    const [item] = (await service.getById('8', { permissions: permissionsForRoles(['operator']) })).subscriptions;
    expect(item.latestCycle.delivery).toEqual({ kind: 'ups', id: 2, status: 'label_created', trackingNumber: '1Z999' });
    expect(item.latestCycle).not.toHaveProperty('nfe');
    expect(nfeRepository.listByStripeInvoices).not.toHaveBeenCalled();
  });

  test('a rejected note carries its status and last error', async () => {
    const [item] = await subscriptionsFor({
      notes: [{ id: 3, stripeInvoiceId: 'in_br', nfeNumber: null, nfeSeries: null, status: 'rejected', lastError: 'CPF inválido', emailStatus: null }]
    }, ['nfe.read']);
    expect(item.latestCycle.nfe).toMatchObject({ status: 'rejected', lastError: 'CPF inválido' });
  });

  test('a failed NF-e lookup still returns the detail and flags every subscription', async () => {
    const { service, nfeRepository, logger } = build({
      rows: [ledgerRow(), ledgerRow({ id: 13, stripeSubscriptionId: 'sub_br2' })],
      views: { 11: cycleView(), 13: cycleView({ invoiceId: 'in_br2' }) }
    });
    nfeRepository.listByStripeInvoices.mockRejectedValue(Object.assign(new Error('db down'), { code: 'ECONNRESET' }));
    const detail = await service.getById('8', { permissions: permissionsForRoles(['operator']) });
    expect(detail.email).toBe('ana@example.com');
    expect(detail.subscriptions).toHaveLength(2);
    for (const item of detail.subscriptions) {
      expect(item.latestCycleUnavailable).toBe(true);
      expect(item).not.toHaveProperty('latestCycle');
    }
    expect(logger.warn).toHaveBeenCalledWith({ userId: '8', code: 'ECONNRESET' }, expect.any(String));
  });
});

describe('customer detail subscriptions: alerts', () => {
  const authorized = { id: 3, stripeInvoiceId: 'in_br', nfeNumber: '123', nfeSeries: '1', status: 'authorized', lastError: null, emailStatus: 'sent' };
  const delivered = { id: 5, status: 'delivered', outForDeliveryAt: null, deliveredAt: '2026-11-10T15:00:00.000Z', failedAt: null };

  test('a subscription without problems carries alerts: []', async () => {
    const [item] = await subscriptionsFor({
      views: { 11: cycleView({ courierDelivery: delivered }) },
      notes: [authorized]
    }, permissionsForRoles(['operator']));
    expect(item.alerts).toEqual([]);
  });

  test('an operator sees nfe_problem for a rejected note', async () => {
    const [item] = await subscriptionsFor({
      views: { 11: cycleView({ courierDelivery: delivered }) },
      notes: [{ ...authorized, nfeNumber: null, status: 'rejected', lastError: 'CPF inválido' }]
    }, permissionsForRoles(['operator']));
    expect(item.alerts).toEqual([{ code: 'nfe_problem', nfeId: 3, status: 'rejected', lastError: 'CPF inválido' }]);
  });

  test('an actor without nfe.read gets no NF-e alert for a rejected note (synthetic actor)', async () => {
    const [item] = await subscriptionsFor({
      views: { 11: cycleView({ courierDelivery: delivered }) },
      notes: [{ ...authorized, status: 'rejected', lastError: 'CPF inválido' }]
    }, ['users.read', 'production.read', 'shipping.read']);
    expect(item.alerts).toEqual([]);
  });

  test('with latestCycleUnavailable only pending_change is computed', async () => {
    const { service, nfeRepository } = build({
      rows: [ledgerRow({ editPending: { invoice_id: 'in_next' } })],
      notes: []
    });
    nfeRepository.listByStripeInvoices.mockRejectedValue(new Error('db down'));
    const [item] = (await service.getById('8', { permissions: permissionsForRoles(['operator']) })).subscriptions;
    expect(item.latestCycleUnavailable).toBe(true);
    expect(item.alerts).toEqual([{ code: 'pending_change', kinds: ['edit'] }]);
  });

  test('users.read alone still gets pending_change', async () => {
    const [item] = await subscriptionsFor({ rows: [ledgerRow({ pendingDeliveryChanges: { charge_move: { trial_end: 1 } } })] }, ['users.read']);
    expect(item).not.toHaveProperty('latestCycle');
    expect(item.alerts).toEqual([{ code: 'pending_change', kinds: ['delivery'] }]);
  });
});


describe('customer detail subscriptions: pets', () => {
  const twoPets = {
    pets: [
      { pet_id: 'rex', pet_name: 'Rex', enabled: true },
      { pet_id: 'luna', pet_name: 'Luna', enabled: true }
    ]
  };

  test('an active subscription lists its two pets', async () => {
    const [item] = await subscriptionsFor({ rows: [ledgerRow({ planSelection: twoPets })] }, ['users.read']);
    expect(item.pets).toEqual([{ id: 'rex', name: 'Rex' }, { id: 'luna', name: 'Luna' }]);
  });

  test('a canceled subscription lists no pet', async () => {
    const [item] = await subscriptionsFor({ rows: [ledgerRow({ status: 'canceled', planSelection: twoPets })] }, ['users.read']);
    expect(item.pets).toEqual([]);
  });

  test('pets stay when the latest cycles cannot be read', async () => {
    const { service, paidCyclesService } = build({ rows: [ledgerRow({ planSelection: twoPets })] });
    paidCyclesService.latestBySubscriptions.mockRejectedValue(new Error('db down'));
    const [item] = (await service.getById('8', { permissions: permissionsForRoles(['operator']) })).subscriptions;
    expect(item.latestCycleUnavailable).toBe(true);
    expect(item.pets).toEqual([{ id: 'rex', name: 'Rex' }, { id: 'luna', name: 'Luna' }]);
  });
});
