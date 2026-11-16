const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');
const { UpsShipmentRepository } = require('../src/infrastructure/repositories/ups-shipment.repository');
const { UpsShipmentService } = require('../src/services/ups-shipment.service');

const address = { name: 'Ana Costa', line1: '1 Main St', city: 'Miami', state: 'FL', postal_code: '33101', country: 'US' };
const cycle = (id, invoice, extra = {}) => ({
  id, stripeSubscriptionId: `sub_${id}`, paidInvoiceId: invoice, productionStatus: 'ready', status: 'active',
  deliveryDate: '2026-11-05', address, userId: 7, ...extra
});

function queueService({ cycles, atWork = [], later = 0, shipments = [], configured = true, addressIssueService, pickupRepository, profileRepository }) {
  const listPaidLabelCycles = jest.fn().mockResolvedValue(cycles);
  const listLabelCyclesWithActiveShipment = jest.fn().mockResolvedValue(atWork);
  const countPaidLabelCyclesWithoutShipment = jest.fn().mockResolvedValue(later);
  const service = new UpsShipmentService({
    repository: { listActiveByInvoiceIds: jest.fn().mockResolvedValue(shipments) },
    ledgerRepository: { listPaidLabelCycles, listLabelCyclesWithActiveShipment, countPaidLabelCyclesWithoutShipment },
    upsClient: { isConfigured: () => configured },
    shippingService: { settings: { us: { ship_from: { zipcode: '33101' } } } },
    addressIssueService,
    pickupRepository,
    profileRepository,
    now: () => new Date('2026-11-03T12:00:00Z')
  });
  return { service, listPaidLabelCycles, listLabelCyclesWithActiveShipment, countPaidLabelCyclesWithoutShipment };
}

describe('paid cycle read for the label queue', () => {
  test('reads every paid US cycle from 30 days back, with no production status filter', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listPaidLabelCycles({ deliveryFloor: '2026-10-04', limit: 101 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL AND (q.stripe_account = 'us' AND");
    expect(sql).toContain("'$.country')), ''))) = 'US')");
    expect(sql).toContain('COALESCE(q.delivery_date, DATE(q.cycle_period_end)) >= ?');
    expect(sql).not.toContain('production_status =');
    expect(params).toEqual(['2026-10-04', 101]);
  });

  test('ready cycles have no label that is not voided and stop at the ceiling', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listPaidLabelCycles({ deliveryFloor: '2026-10-07', deliveryCeiling: '2026-11-07', limit: 101 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM `ups_shipments` us WHERE us.stripe_invoice_id COLLATE utf8mb4_unicode_ci = q.paid_invoice_id COLLATE utf8mb4_unicode_ci AND us.status <> 'voided')");
    expect(params).toEqual(['2026-10-07', '2026-11-07', 101]);
  });

  test('cycles with a label at work have no ceiling and no limit', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listLabelCyclesWithActiveShipment({ deliveryFloor: '2026-10-07' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("us.status IN ('pending', 'unknown', 'created')");
    expect(sql).not.toContain('LIMIT');
    expect(sql).not.toContain('<= ?');
    expect(params).toEqual(['2026-10-07']);
  });

  test('counts the cycles waiting for a label after a date', async () => {
    const query = jest.fn().mockResolvedValue([{ total: 4 }]);
    await expect(new SubscriptionLedgerRepository({ isInitialized: true, query }).countPaidLabelCyclesWithoutShipment({ deliveryFloor: '2026-11-08' })).resolves.toBe(4);
    expect(query.mock.calls[0][0]).toContain("us.status <> 'voided'");
    expect(query.mock.calls[0][1]).toEqual(['2026-11-08']);
  });

  test('active shipments include pending and unknown rows, never voided ones', async () => {
    const query = jest.fn().mockResolvedValue([]);
    await new UpsShipmentRepository({ isInitialized: true, query }).listActiveByInvoiceIds(['in_1', 'in_2']);

    expect(query.mock.calls[0][0]).toContain("`stripe_invoice_id` IN (?, ?) AND `status` <> 'voided'");
  });
});

describe('UpsShipmentService.listLabelQueue', () => {
  test('groups ready, unresolved and created orders and drops delivered ones', async () => {
    const { service, listPaidLabelCycles } = queueService({
      cycles: [
        cycle(1, 'in_ready'),
        cycle(2, 'in_pending'),
        cycle(3, 'in_unknown'),
        cycle(4, 'in_created'),
        cycle(5, 'in_delivered'),
        cycle(6, 'in_old_voided')
      ],
      shipments: [
        { id: 12, stripe_invoice_id: 'in_pending', status: 'pending' },
        { id: 13, stripe_invoice_id: 'in_unknown', status: 'unknown' },
        { id: 14, stripe_invoice_id: 'in_created', status: 'created', ups_shipment_id: 'ups_14', tracking_number: '1Z14' },
        { id: 15, stripe_invoice_id: 'in_delivered', status: 'delivered', ups_shipment_id: 'ups_15' }
      ]
    });

    const { data } = await service.listLabelQueue({});

    expect(listPaidLabelCycles).toHaveBeenCalledWith({ deliveryFloor: '2026-10-04', deliveryCeiling: '2026-11-04', limit: 101, upsTableName: 'ups_shipments' });
    expect(data.ready.map((item) => item.invoice_id)).toEqual(['in_ready', 'in_old_voided']);
    expect(data.ready[0]).toMatchObject({
      customer_name: 'Ana Costa', city: 'Miami', zipcode: '33101', production_status: 'ready',
      subscription_status: 'active', delivery_date: '2026-11-05', issues: [], shipment: null
    });
    expect(data.unresolved.map((item) => [item.invoice_id, item.shipment.id])).toEqual([['in_pending', 12], ['in_unknown', 13]]);
    expect(data.created.map((item) => item.invoice_id)).toEqual(['in_created']);
    expect(data.truncated).toBe(false);
  });

  test('ready rows carry the address problem, and reading the queue opens none', async () => {
    const issue = { id: 3, codes: ['po_box_not_allowed'], email_sent_at: null };
    const addressIssueService = { report: jest.fn(), latestForSubscriptions: jest.fn(async () => new Map([[1, issue]])) };
    const { service } = queueService({
      cycles: [cycle(1, 'in_ready', { address: { ...address, line1: 'PO Box 9' } }), cycle(2, 'in_created')],
      shipments: [{ id: 14, stripe_invoice_id: 'in_created', status: 'created', ups_shipment_id: 'ups_14' }],
      addressIssueService
    });
    const { data } = await service.listLabelQueue({});
    expect(data.ready[0]).toMatchObject({ subscription_id: '1', address_issue: issue });
    expect(data.created[0]).not.toHaveProperty('address_issue');
    expect(addressIssueService.latestForSubscriptions).toHaveBeenCalledWith([1]);
    expect(addressIssueService.report).not.toHaveBeenCalled();
  });

  test('Two paid cycles without a label: both are listed', async () => {
    const { service } = queueService({ cycles: [cycle(1, 'in_a'), cycle(1, 'in_b', { productionStatus: 'to_prepare' })] });

    const { data } = await service.listLabelQueue({});

    expect(data.ready.map((item) => [item.invoice_id, item.production_status])).toEqual([['in_a', 'ready'], ['in_b', 'to_prepare']]);
  });

  test('Paused subscription with a paid cycle is listed with its status', async () => {
    const { service } = queueService({ cycles: [cycle(1, 'in_a', { status: 'paused' })] });

    expect((await service.listLabelQueue({})).data.ready[0].subscription_status).toBe('paused');
  });

  test('Blocked order: a P.O. Box shows its reason', async () => {
    const { service } = queueService({ cycles: [cycle(1, 'in_a', { address: { ...address, line1: 'PO Box 12' } })] });

    expect((await service.listLabelQueue({})).data.ready[0].issues).toEqual([{ code: 'po_box_not_allowed' }]);
  });

  test('caps the read at 100 orders and reports it', async () => {
    const cycles = Array.from({ length: 101 }, (_, index) => cycle(index + 1, `in_${index}`));
    const { service } = queueService({ cycles });

    const { data } = await service.listLabelQueue({});

    expect(data.ready).toHaveLength(100);
    expect(data.truncated).toBe(true);
    expect(data.next_from).toBe('2026-11-05');
  });

  // admin-flow-fixes-5 (PM-29): ready orders by delivery range, in New York.
  test('the default range ends tomorrow in New York and counts what comes later', async () => {
    const { service, listLabelCyclesWithActiveShipment, countPaidLabelCyclesWithoutShipment } = queueService({ cycles: [cycle(1, 'in_ready', { deliveryDate: '2026-11-04' })], later: 2 });

    const { data } = await service.listLabelQueue({});

    expect(data.range).toEqual({ from: '2026-10-04', to: '2026-11-04', default: true });
    expect(data.later).toBe(2);
    expect(data.next_from).toBeNull();
    expect(listLabelCyclesWithActiveShipment).toHaveBeenCalledWith({ deliveryFloor: '2026-10-04', upsTableName: 'ups_shipments' });
    expect(countPaidLabelCyclesWithoutShipment).toHaveBeenCalledWith({ deliveryFloor: '2026-11-05', upsTableName: 'ups_shipments' });
  });

  test('a created label after the range shows next to a full ready list', async () => {
    const ready = Array.from({ length: 101 }, (_, index) => cycle(index + 1, `in_${index}`, { deliveryDate: '2026-11-04' }));
    const { service } = queueService({
      cycles: ready,
      atWork: [cycle(500, 'in_created', { deliveryDate: '2026-11-08' })],
      shipments: [{ id: 14, stripe_invoice_id: 'in_created', status: 'created', ups_shipment_id: 'ups_14' }]
    });

    const { data } = await service.listLabelQueue({});

    expect(data.ready).toHaveLength(100);
    expect(data.created.map((item) => item.invoice_id)).toEqual(['in_created']);
  });

  test('the range from the query reaches the ledger', async () => {
    const { service, listPaidLabelCycles } = queueService({ cycles: [] });

    const { data } = await service.listLabelQueue({}, { from: '2026-11-03', to: '2026-11-09' });

    expect(data.range).toEqual({ from: '2026-11-03', to: '2026-11-09', default: false });
    expect(listPaidLabelCycles.mock.calls[0][0]).toMatchObject({ deliveryFloor: '2026-11-03', deliveryCeiling: '2026-11-09' });
  });

  test('a range of more than 31 days is refused', async () => {
    const { service } = queueService({ cycles: [] });

    await expect(service.listLabelQueue({}, { from: '2026-10-05', to: '2026-11-30' })).rejects.toMatchObject({ statusCode: 400, details: { code: 'invalid_delivery_range' } });
  });

  test('created labels carry their active pickup, read once; a canceled one gives null', async () => {
    const pickupRepository = {
      listActiveByIds: jest.fn().mockResolvedValue([
        { id: 31, pickup_date: '2026-11-09', status: 'requested', prn: '2929602E9CP', shipment_ids: [14] },
        { id: 33, pickup_date: '2026-11-03', status: 'pending', prn: null, created_at: new Date('2026-11-03T11:00:00Z') }
      ])
    };
    const { service } = queueService({
      cycles: [cycle(2, 'in_a'), cycle(3, 'in_b'), cycle(4, 'in_c')],
      shipments: [
        { id: 14, stripe_invoice_id: 'in_a', status: 'created', ups_shipment_id: 'ups_14', pickup_id: 31 },
        { id: 15, stripe_invoice_id: 'in_b', status: 'created', ups_shipment_id: 'ups_15', pickup_id: 32 },
        { id: 16, stripe_invoice_id: 'in_c', status: 'created', ups_shipment_id: 'ups_16', pickup_id: 33 }
      ],
      pickupRepository
    });

    const { data } = await service.listLabelQueue({}, {});

    expect(pickupRepository.listActiveByIds).toHaveBeenCalledTimes(1);
    expect(pickupRepository.listActiveByIds).toHaveBeenCalledWith([31, 32, 33]);
    expect(data.created.map((item) => item.pickup)).toEqual([
      { id: 31, pickup_date: '2026-11-09', status: 'requested', prn: '2929602E9CP' },
      null,
      // A reservation left pending for an hour reads as unknown.
      { id: 33, pickup_date: '2026-11-03', status: 'unknown', prn: null }
    ]);
    expect(data.created[0]).not.toHaveProperty('pickup_id');
  });
});

describe('label queue delivery instructions (delivery-instructions)', () => {
  const profileRepository = {
    listDeliveryContacts: jest.fn(async () => new Map([['7', {
      phone: null, deliveryInstructions: 'Ring twice', profileAddress: { country: 'US', zipcode: '33101', street: '1 main st', number: '' }
    }]])),
    findUserById: jest.fn(async () => null)
  };

  test('Order with instructions: the subscription text with its source', async () => {
    const { service } = queueService({
      cycles: [cycle(1, 'in_1', { address: { ...address, delivery_instructions: 'Leave at back door' } })],
      profileRepository
    });
    const { data } = await service.listLabelQueue();
    expect(data.ready[0]).toMatchObject({ delivery_instructions: 'Leave at back door', delivery_instructions_source: 'subscription' });
  });

  test('the profile text at the same place, none at another place', async () => {
    const { service } = queueService({
      cycles: [
        cycle(1, 'in_1'),
        cycle(2, 'in_2', { address: { ...address, line1: '9 Ocean Dr', postal_code: '33139' } })
      ],
      profileRepository
    });
    const { data } = await service.listLabelQueue();
    expect(data.ready.map((item) => [item.delivery_instructions, item.delivery_instructions_source])).toEqual([
      ['Ring twice', 'profile'],
      [null, null]
    ]);
  });
});
