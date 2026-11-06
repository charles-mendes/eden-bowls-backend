const { AdminTodayService } = require('../src/services/admin-today.service');

const NOW = new Date('2026-10-07T15:00:00Z');

function row(overrides = {}) {
  return {
    id: 1,
    userId: '10',
    customerEmail: 'ana@example.com',
    stripeSubscriptionId: 'sub_1',
    stripeAccount: 'us',
    status: 'active',
    currentPeriodEnd: '2026-10-07 16:00:00',
    dueAt: '2026-10-07 16:00:00',
    paymentState: 'paid',
    productionStatus: 'ready',
    paidInvoiceId: 'in_1',
    address: { name: 'Ana', city: 'Miami', country: 'US' },
    ...overrides
  };
}

function service({ rows, total = rows.length, shipments = [], closed = [], courierRows = [], courierCounts = { toDispatch: 0, onTheRoadLong: 0, failed: 0 }, nfeCounts = {}, upsUnresolved = 0, bling = { configured: true, connected: true }, contacts = new Map(), people = new Map(), issueCounts = new Map(), exceptionCounts = new Map(), withIssues = true }) {
  const ledgerRepository = { listQueue: jest.fn().mockResolvedValue({ total, items: rows }), countMarketExceptions: jest.fn(async ({ stripeAccounts }) => new Map([...exceptionCounts].filter(([account]) => stripeAccounts.includes(account)))) };
  const deliveryAddressIssuesRepository = withIssues
    ? { countOpenByAccount: jest.fn(async ({ stripeAccounts }) => new Map([...issueCounts].filter(([account]) => stripeAccounts.includes(account)))) }
    : null;
  const upsShipmentRepository = { listActiveByInvoiceIds: jest.fn().mockResolvedValue(shipments), countUnresolved: jest.fn().mockResolvedValue(upsUnresolved) };
  const calendar = { listActive: jest.fn().mockResolvedValue(closed) };
  const courierDeliveryService = { countQueue: jest.fn().mockResolvedValue(courierCounts) };
  const courierDeliveryRepository = { listByInvoiceIds: jest.fn().mockResolvedValue(courierRows) };
  const blingNfeRepository = { countByStatuses: jest.fn().mockResolvedValue({ blocked_missing_document: 0, rejected: 0, error: 0, ...nfeCounts }) };
  const blingNfeService = { connectionStatus: jest.fn().mockResolvedValue({ success: true, data: bling }) };
  const customerContactsRepository = { latestBySubscriptions: jest.fn().mockResolvedValue(contacts) };
  const profileRepository = { listDeliveryContacts: jest.fn().mockResolvedValue(people) };
  return {
    ledgerRepository,
    upsShipmentRepository,
    courierDeliveryService,
    courierDeliveryRepository,
    blingNfeRepository,
    customerContactsRepository,
    profileRepository,
    deliveryAddressIssuesRepository,
    service: new AdminTodayService({
      ledgerRepository, upsShipmentRepository, calendar, courierDeliveryService, courierDeliveryRepository,
      blingNfeRepository, blingNfeService, customerContactsRepository, profileRepository, deliveryAddressIssuesRepository, now: () => NOW
    })
  };
}

const brRow = (overrides = {}) => row({ stripeAccount: 'br', address: { name: 'Ana', city: 'Curitiba', country: 'BR' }, ...overrides });
const adminActor = { roles: ['admin'], permissions: ['bling.connect'] };
const brOperator = { roles: ['operator'], markets: ['BR'], permissions: ['production.read'] };

describe('AdminTodayService', () => {
  test('counts today, tomorrow and overdue work per market', async () => {
    const { service: today } = service({
      rows: [
        row({ id: 1 }),
        row({ id: 2, stripeAccount: 'br', paidInvoiceId: null, address: { city: 'Curitiba', country: 'BR' }, dueAt: '2026-10-08 15:00:00' }),
        row({ id: 3, dueAt: '2026-10-05 15:00:00' })
      ]
    });

    const result = await today.overview({ timezone: 'America/Sao_Paulo' });

    expect(result.data.today).toBe('2026-10-07');
    expect(result.data.totals).toEqual({ overdue: 1, today: 1, tomorrow: 1 });
    expect(result.data.byMarket.BR).toEqual({ overdue: 0, today: 0, tomorrow: 1 });
    expect(result.data.byMarket.US).toEqual({ overdue: 1, today: 1, tomorrow: 0 });
  });

  test('asks the queue for the overdue month and the next two civil days', async () => {
    const { service: today, ledgerRepository } = service({ rows: [] });

    await today.overview({ timezone: 'America/Sao_Paulo' });

    expect(ledgerRepository.listQueue).toHaveBeenCalledWith(expect.objectContaining({
      startOfToday: '2026-10-07 03:00:00',
      windowEndExclusive: '2026-10-09 03:00:00',
      overdueFloor: '2026-09-07 03:00:00',
      includeOverdue: true
    }));
  });

  test('flags a paid US cycle whose invoice has no UPS label', async () => {
    const { service: today, upsShipmentRepository } = service({
      rows: [row({ id: 1, paidInvoiceId: 'in_1' }), row({ id: 2, paidInvoiceId: 'in_2' }), row({ id: 3, paymentState: 'awaiting_payment', paidInvoiceId: null })],
      shipments: [{ stripe_invoice_id: 'in_1', status: 'created' }]
    });

    const result = await today.overview({});

    expect(upsShipmentRepository.listActiveByInvoiceIds).toHaveBeenCalledWith(['in_1', 'in_2']);
    expect(result.data.items.map((item) => [item.id, item.upsLabel])).toEqual([[1, 'created'], [2, 'missing'], [3, null]]);
    expect(result.data.items[0]).not.toHaveProperty('paidInvoiceId');
  });

  test('marks a purchase UPS never confirmed as unresolved, and a delivered label as created', async () => {
    const { service: today } = service({
      rows: [row({ id: 1, paidInvoiceId: 'in_1' }), row({ id: 2, paidInvoiceId: 'in_2' }), row({ id: 3, paidInvoiceId: 'in_3' }), row({ id: 4, paidInvoiceId: 'in_4' })],
      shipments: [
        { stripe_invoice_id: 'in_1', status: 'pending' },
        { stripe_invoice_id: 'in_2', status: 'unknown' },
        { stripe_invoice_id: 'in_3', status: 'delivered' }
      ]
    });

    const result = await today.overview({});

    expect(result.data.items.map((item) => [item.id, item.upsLabel])).toEqual([[1, 'unresolved'], [2, 'unresolved'], [3, 'created'], [4, 'missing']]);
  });

  test('lists closed days of today and tomorrow for the markets in scope', async () => {
    const { service: today } = service({
      rows: [],
      closed: [
        { market: 'BR', closedOn: '2026-10-12', label: 'Nossa Senhora Aparecida', closesDelivery: true },
        { market: 'BR', closedOn: '2026-10-08', label: 'Folga', closesPreparation: true, closesDelivery: true },
        { market: 'US', closedOn: '2026-10-07', label: 'Company day', closesDelivery: true }
      ]
    });

    const result = await today.overview({}, { roles: ['operator'], markets: ['BR'] });

    expect(result.data.closedDays).toEqual([
      expect.objectContaining({ market: 'BR', date: '2026-10-08', label: 'Folga' })
    ]);
  });

  test('a paid Brazil item says where its box is, a canceled attempt counting as none', async () => {
    const { service: today, courierDeliveryRepository } = service({
      rows: [brRow({ id: 1, paidInvoiceId: 'in_1' }), brRow({ id: 2, paidInvoiceId: 'in_2' }), brRow({ id: 3, paidInvoiceId: 'in_3' }), brRow({ id: 4, paidInvoiceId: 'in_4' }), row({ id: 5, paidInvoiceId: 'in_5' })],
      courierRows: [
        { id: 1, stripe_invoice_id: 'in_1', status: 'out_for_delivery' },
        { id: 2, stripe_invoice_id: 'in_2', status: 'failed' },
        { id: 3, stripe_invoice_id: 'in_3', status: 'failed' },
        { id: 4, stripe_invoice_id: 'in_3', status: 'delivered' },
        { id: 5, stripe_invoice_id: 'in_4', status: 'canceled' }
      ]
    });

    const result = await today.overview({});

    expect(courierDeliveryRepository.listByInvoiceIds).toHaveBeenCalledWith(['in_1', 'in_2', 'in_3', 'in_4']);
    expect(result.data.items.map((item) => [item.id, item.courierDelivery])).toEqual([
      [1, 'out_for_delivery'], [2, 'failed'], [3, 'delivered'], [4, 'none'], [5, null]
    ]);
  });

  test('counts shipping and invoice work on its own, beyond the 200 items of the list', async () => {
    const rows = Array.from({ length: 200 }, (_, index) => brRow({ id: index + 1, paidInvoiceId: `in_${index + 1}` }));
    const { service: today } = service({
      rows,
      total: 250,
      courierCounts: { toDispatch: 230, onTheRoadLong: 2, failed: 1 },
      nfeCounts: { rejected: 1, error: 3 },
      upsUnresolved: 4
    });

    const result = await today.overview({}, adminActor);

    expect(result.data.truncated).toBe(true);
    expect(result.data.fulfillment).toEqual({
      courierToDispatch: 230, courierOnTheRoadLong: 2, courierFailed: 1,
      nfeMissingDocument: 0, nfeRejected: 1, nfeError: 3,
      upsUnresolved: 4, blingConnected: true,
      addressIssues: { BR: { open: 0, stale: 0 }, US: { open: 0, stale: 0 } },
      marketExceptions: { BR: 0, US: 0 }
    });
  });

  // admin-flow-fixes-5 (PM-26): address problems and market exceptions per market.
  test('counts open address problems per market, stale from 72 hours', async () => {
    const { service: today, deliveryAddressIssuesRepository } = service({
      rows: [],
      issueCounts: new Map([['br', { open: 2, stale: 1 }], ['us', { open: 1, stale: 0 }]]),
      exceptionCounts: new Map([['us', 230], ['br', 1]])
    });

    const result = await today.overview({}, adminActor);

    expect(result.data.fulfillment.addressIssues).toEqual({ BR: { open: 2, stale: 1 }, US: { open: 1, stale: 0 } });
    expect(result.data.fulfillment.marketExceptions).toEqual({ BR: 1, US: 230 });
    expect(deliveryAddressIssuesRepository.countOpenByAccount).toHaveBeenCalledWith({
      staleBefore: new Date(NOW.getTime() - 72 * 3600 * 1000),
      stripeAccounts: ['br', 'us']
    });
  });

  test('a Brazil operator gets no US address problem nor exception', async () => {
    const { service: today, ledgerRepository } = service({
      rows: [],
      issueCounts: new Map([['br', { open: 1, stale: 0 }], ['us', { open: 4, stale: 2 }]]),
      exceptionCounts: new Map([['us', 1]])
    });

    const result = await today.overview({}, brOperator);

    expect(result.data.fulfillment.addressIssues).toEqual({ BR: { open: 1, stale: 0 }, US: { open: 0, stale: 0 } });
    expect(result.data.fulfillment.marketExceptions).toEqual({ BR: 0, US: 0 });
    expect(ledgerRepository.countMarketExceptions).toHaveBeenCalledWith({ stripeAccounts: ['br'] });
  });

  test('without the address problems repository the counts are 0', async () => {
    const result = await service({ rows: [], withIssues: false }).service.overview({}, adminActor);

    expect(result.data.fulfillment.addressIssues).toEqual({ BR: { open: 0, stale: 0 }, US: { open: 0, stale: 0 } });
  });

  test('a Brazil operator gets no US counts and no Bling state', async () => {
    const { service: today, upsShipmentRepository, courierDeliveryService } = service({
      rows: [],
      courierCounts: { toDispatch: 2, onTheRoadLong: 0, failed: 0 },
      nfeCounts: { rejected: 1 },
      upsUnresolved: 5
    });

    const result = await today.overview({}, brOperator);

    expect(courierDeliveryService.countQueue).toHaveBeenCalledWith(brOperator);
    expect(upsShipmentRepository.countUnresolved).not.toHaveBeenCalled();
    expect(result.data.fulfillment).toMatchObject({ courierToDispatch: 2, nfeRejected: 1, upsUnresolved: 0, blingConnected: null });
  });

  test('the US on screen counts no Brazil work', async () => {
    const { service: today, courierDeliveryService, blingNfeRepository } = service({ rows: [], upsUnresolved: 1 });

    const result = await today.overview({ account: 'us' }, adminActor);

    expect(courierDeliveryService.countQueue).not.toHaveBeenCalled();
    expect(blingNfeRepository.countByStatuses).not.toHaveBeenCalled();
    expect(result.data.fulfillment).toMatchObject({ courierToDispatch: 0, nfeRejected: 0, upsUnresolved: 1 });
  });

  test('an admin hears that Bling is disconnected; nothing where Bling is not configured', async () => {
    const disconnected = await service({ rows: [], bling: { configured: true, connected: false } }).service.overview({}, adminActor);
    expect(disconnected.data.fulfillment.blingConnected).toBe(false);

    const absent = await service({ rows: [], bling: { configured: false, connected: false } }).service.overview({}, adminActor);
    expect(absent.data.fulfillment.blingConnected).toBeNull();
  });

  test('a refused payment carries the last contact and the account phone; other items carry no phone', async () => {
    const { service: today, customerContactsRepository, profileRepository } = service({
      rows: [
        row({ id: 1, userId: '10', paymentState: 'past_due', paidInvoiceId: null }),
        row({ id: 2, userId: '11', paymentState: 'past_due', paidInvoiceId: null }),
        row({ id: 3, userId: '12' })
      ],
      contacts: new Map([['1', { id: 8, subscription_id: '1', reason: 'payment_failed', outcome: 'no_answer', note: null, actor_email: 'ops@edenbowls.com', created_at: new Date('2026-11-04T17:05:00Z') }]]),
      people: new Map([['10', { phone: '+1 305 555 0101', deliveryInstructions: null }]])
    });

    const result = await today.overview({});

    expect(customerContactsRepository.latestBySubscriptions).toHaveBeenCalledWith([1, 2]);
    expect(profileRepository.listDeliveryContacts).toHaveBeenCalledWith(['10', '11']);
    const [first, second, third] = result.data.items;
    expect(first.lastContact).toMatchObject({ reason: 'payment_failed', outcome: 'no_answer', actor_email: 'ops@edenbowls.com', created_at: '2026-11-04T17:05:00.000Z' });
    expect(first.phone).toBe('+1 305 555 0101');
    expect(second).toMatchObject({ lastContact: null, phone: null });
    expect(third).not.toHaveProperty('phone');
    expect(third).not.toHaveProperty('lastContact');
  });
});
