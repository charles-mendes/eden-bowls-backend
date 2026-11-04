const { CourierDeliveryService } = require('../src/services/courier-delivery.service');

const NOW = new Date('2026-11-04T15:00:00.000Z');

// In-memory repository with the same guards as the SQL: one active row per invoice, final statuses only from
// out_for_delivery, and no edit of a canceled row.
function memoryRepository(seed = []) {
  const rows = seed.map((row) => ({ ...row }));
  let nextId = rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const copy = (row) => (row ? { ...row } : null);
  return {
    rows,
    async insert(payload) {
      await Promise.resolve();
      if (rows.some((row) => row.stripe_invoice_id === payload.invoiceId && ['out_for_delivery', 'delivered'].includes(row.status))) {
        return { inserted: false, row: null };
      }
      const row = {
        id: nextId++,
        subscription_id: payload.subscriptionId,
        user_id: payload.userId,
        stripe_account: payload.stripeAccount,
        stripe_invoice_id: payload.invoiceId,
        method: payload.method,
        courier_name: payload.courierName || null,
        tracking_url: payload.trackingUrl || null,
        cost_minor: payload.costMinor == null ? null : payload.costMinor,
        currency: 'brl',
        note: payload.note || null,
        status: 'out_for_delivery',
        out_for_delivery_at: payload.outForDeliveryAt,
        delivered_at: null,
        failed_at: null,
        failure_reason: null,
        canceled_at: null,
        created_by: payload.actorId || null
      };
      rows.push(row);
      return { inserted: true, row: copy(row) };
    },
    async findById(id) {
      return copy(rows.find((row) => row.id === Number(id)));
    },
    async listBySubscriptionId(id) {
      return rows.filter((row) => row.subscription_id === String(id)).sort((a, b) => b.id - a.id).map(copy);
    },
    async listByInvoiceIds(ids) {
      return rows.filter((row) => ids.includes(row.stripe_invoice_id)).map(copy);
    },
    async listByStatus(status) {
      return rows.filter((row) => row.status === status).map(copy);
    },
    async listDeliveredSince(since) {
      return rows.filter((row) => row.status === 'delivered' && new Date(row.delivered_at) >= since).map(copy);
    },
    async transition(id, status, fields) {
      await Promise.resolve();
      const row = rows.find((item) => item.id === Number(id) && item.status === 'out_for_delivery');
      if (!row) return 0;
      row.status = status;
      row[{ delivered: 'delivered_at', failed: 'failed_at', canceled: 'canceled_at' }[status]] = fields.at;
      if (status === 'failed') row.failure_reason = fields.reason;
      return 1;
    },
    async updateDetails(id, details) {
      const row = rows.find((item) => item.id === Number(id) && item.status !== 'canceled');
      if (!row) return 0;
      const columns = { method: 'method', courierName: 'courier_name', trackingUrl: 'tracking_url', costMinor: 'cost_minor', note: 'note' };
      Object.entries(details).forEach(([key, value]) => { row[columns[key]] = value; });
      return 1;
    }
  };
}

const brSubscription = (extra = {}) => ({
  id: '42',
  stripeSubscriptionId: 'sub_br_1',
  stripeAccount: 'br',
  status: 'active',
  address: { country: 'BR', city: 'São Paulo', neighborhood: 'Pinheiros', postal_code: '05422-000', recipient_name: 'João Lima' },
  user: { id: '7', email: 'ana@example.com' },
  ...extra
});

const paidInvoice = (extra = {}) => ({ id: 'in_1', status: 'paid', subscription: 'sub_br_1', billing_reason: 'subscription_cycle', subtotal: 25900, ...extra });

function setup({ subscription = brSubscription(), invoice = paidInvoice(), productionStatus = 'ready', seed = [], cycles = [], mailer } = {}) {
  const repository = memoryRepository(seed);
  const auditService = { record: jest.fn() };
  const transactionalMailer = mailer || { notifyCourierOutForDelivery: jest.fn(), notifyCourierDelivered: jest.fn() };
  const adminBillingService = {
    getSubscription: jest.fn(async () => subscription),
    getSubscriptionInvoice: jest.fn(async () => invoice)
  };
  const ledgerRepository = {
    listPaidCyclesByInvoiceIds: jest.fn(async (ids) => {
      const fromCycles = cycles.filter((cycle) => ids.includes(cycle.paidInvoiceId));
      if (fromCycles.length || cycles.length) return fromCycles;
      return ids.map((paidInvoiceId) => ({ id: 42, paidInvoiceId, productionStatus, status: 'active' }));
    }),
    listPaidCourierCycles: jest.fn(async ({ deliveryFloor }) => cycles.filter((cycle) => (cycle.deliveryDate || '') >= deliveryFloor))
  };
  const logger = { error: jest.fn(), warn() {}, info() {} };
  const service = new CourierDeliveryService({ repository, adminBillingService, ledgerRepository, auditService, transactionalMailer, logger, now: () => NOW });
  return { service, repository, auditService, transactionalMailer, adminBillingService, ledgerRepository, logger };
}

const actor = { userId: 99, email: 'ops@edenbowls.com' };
const dispatchBody = (extra = {}) => ({ invoice_id: 'in_1', method: 'uber', cost: '18.50', tracking_url: 'https://trip.uber.com/abc123', ...extra });
const code = async (promise) => promise.then(() => null, (error) => ({ status: error.statusCode, code: error.details && error.details.code, details: error.details }));

describe('Only a paid Brazil delivery can get a courier record', () => {
  test('Paid Brazil cycle is stored as out for delivery', async () => {
    const { service, repository } = setup();
    const result = await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    expect(result.data.delivery).toMatchObject({ status: 'out_for_delivery', stripe_invoice_id: 'in_1', subscription_id: '42' });
    expect(repository.rows).toHaveLength(1);
  });

  test('US subscription gets courier_country_not_supported', async () => {
    const { service, repository } = setup({ subscription: brSubscription({ address: { country: 'US' } }) });
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }))).toMatchObject({ status: 422, code: 'courier_country_not_supported' });
    expect(repository.rows).toHaveLength(0);
  });

  test('an address with no country is refused the same way', async () => {
    const { service } = setup({ subscription: brSubscription({ address: {} }) });
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }))).toMatchObject({ code: 'courier_country_not_supported' });
  });

  test.each([
    ['Skipped cycle', paidInvoice({ subtotal: 0 }), 'invoice_not_delivery'],
    ['Unpaid invoice', paidInvoice({ status: 'open' }), 'invoice_not_paid'],
    ['Another subscription', paidInvoice({ subscription: 'sub_other' }), 'invoice_not_in_subscription']
  ])('%s', async (_name, invoice, expected) => {
    const { service, repository } = setup({ invoice });
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }))).toMatchObject({ status: 422, code: expected });
    expect(repository.rows).toHaveLength(0);
  });
});

describe('Dispatch records how the box left', () => {
  test('Uber with a tracking link holds method, cost, link, date now and the staff member', async () => {
    const { service, repository } = setup();
    await service.dispatch({ subscriptionId: '42', body: dispatchBody({ courier_name: 'Carlos', note: 'Portão azul' }), actor });
    expect(repository.rows[0]).toMatchObject({
      method: 'uber', cost_minor: 1850, tracking_url: 'https://trip.uber.com/abc123', courier_name: 'Carlos',
      note: 'Portão azul', out_for_delivery_at: NOW, created_by: 99, stripe_account: 'br', user_id: '7'
    });
  });

  test.each([['-1'], ['18.555']])('cost %p returns 422 and stores nothing', async (cost) => {
    const { service, repository } = setup();
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody({ cost }), actor }))).toMatchObject({ status: 422 });
    expect(repository.rows).toHaveLength(0);
  });

  test.each([[undefined], ['drone']])('Method missing (%p) returns 422', async (method) => {
    const { service, repository } = setup();
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody({ method }), actor }))).toMatchObject({ status: 422, details: { field: 'method' } });
    expect(repository.rows).toHaveLength(0);
  });

  test('an http link returns 422 with field tracking_url', async () => {
    const { service } = setup();
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody({ tracking_url: 'http://trip.uber.com/abc' }), actor })))
      .toMatchObject({ status: 422, details: { field: 'tracking_url' } });
  });

  test('invoice_id is required', async () => {
    const { service } = setup();
    expect(await code(service.dispatch({ subscriptionId: '42', body: { method: 'uber' }, actor }))).toMatchObject({ status: 400, code: 'invoice_id_required' });
  });
});

describe('One active delivery per invoice', () => {
  test('Second dispatch while on the road gets courier_delivery_active', async () => {
    const { service, repository } = setup();
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    expect(await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }))).toMatchObject({ status: 409, code: 'courier_delivery_active' });
    expect(repository.rows).toHaveLength(1);
  });

  test('Two dispatches at once leave one record', async () => {
    const { service, repository } = setup();
    const results = await Promise.all([1, 2].map(() => code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }))));
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.find(Boolean)).toMatchObject({ status: 409, code: 'courier_delivery_active' });
    expect(repository.rows).toHaveLength(1);
  });

  test.each([['failed'], ['canceled']])('New attempt after a %s delivery keeps the old row', async (status) => {
    const { service, repository } = setup({ seed: [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status, out_for_delivery_at: NOW }] });
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    expect(repository.rows.map((row) => row.status)).toEqual([status, 'out_for_delivery']);
  });
});

describe('Dispatching an order that is not ready needs confirmation', () => {
  test('Production not ready returns 409 with the reasons and stores nothing', async () => {
    const { service, repository } = setup({ productionStatus: 'in_production' });
    const error = await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }));
    expect(error).toMatchObject({ status: 409, code: 'courier_dispatch_needs_confirmation' });
    expect(error.details.reasons).toEqual([{ code: 'production_not_ready', production_status: 'in_production' }]);
    expect(repository.rows).toHaveLength(0);
  });

  test('a canceled subscription is a reason too', async () => {
    const { service } = setup({ subscription: brSubscription({ status: 'canceled' }) });
    const error = await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }));
    expect(error.details.reasons).toEqual([{ code: 'subscription_not_active', subscription_status: 'canceled' }]);
  });

  test('Confirmed: the record is stored and the audit names the confirmed reasons', async () => {
    const { service, repository, auditService } = setup({ productionStatus: 'in_production' });
    await service.dispatch({ subscriptionId: '42', body: dispatchBody({ confirm_not_ready: true }), actor });
    expect(repository.rows[0].status).toBe('out_for_delivery');
    expect(auditService.record.mock.calls[0][0].metadata.confirmedNotReady).toEqual(['production_not_ready']);
  });
});

describe('Status moves only forward', () => {
  const onTheRoad = () => [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'out_for_delivery', out_for_delivery_at: new Date('2026-11-04T12:00:00Z') }];

  test('Mark delivered with no date uses now', async () => {
    const { service, repository } = setup({ seed: onTheRoad() });
    const result = await service.markDelivered(1, {}, actor);
    expect(result.data.delivery).toMatchObject({ status: 'delivered', delivered_at: NOW.toISOString() });
    expect(repository.rows[0].delivered_at).toEqual(NOW);
  });

  test('a past date after the departure is kept', async () => {
    const { service, repository } = setup({ seed: onTheRoad() });
    await service.markDelivered(1, { delivered_at: '2026-11-04T13:30:00Z' }, actor);
    expect(repository.rows[0].delivered_at).toEqual(new Date('2026-11-04T13:30:00Z'));
  });

  test.each([['2026-11-05T10:00:00Z', 'future'], ['2026-11-04T11:00:00Z', 'before departure'], ['not a date', 'invalid']])('delivered date %p (%s) returns 422', async (deliveredAt) => {
    const { service, repository } = setup({ seed: onTheRoad() });
    expect(await code(service.markDelivered(1, { delivered_at: deliveredAt }, actor))).toMatchObject({ status: 422, details: { field: 'delivered_at' } });
    expect(repository.rows[0].status).toBe('out_for_delivery');
  });

  test('Failure without a reason returns 422', async () => {
    const { service, repository } = setup({ seed: onTheRoad() });
    expect(await code(service.markFailed(1, { reason: ' ' }, actor))).toMatchObject({ status: 422, details: { field: 'reason' } });
    expect(repository.rows[0].status).toBe('out_for_delivery');
  });

  test('Change after delivered returns courier_delivery_final', async () => {
    const { service } = setup({ seed: [{ ...onTheRoad()[0], status: 'delivered', delivered_at: NOW }] });
    expect(await code(service.markFailed(1, { reason: 'x' }, actor))).toMatchObject({ status: 409, code: 'courier_delivery_final' });
    expect(await code(service.cancel(1, actor))).toMatchObject({ status: 409, code: 'courier_delivery_final' });
  });

  test('Repeated delivered returns 409 and keeps the date', async () => {
    const delivered = new Date('2026-11-04T13:00:00Z');
    const { service, repository } = setup({ seed: [{ ...onTheRoad()[0], status: 'delivered', delivered_at: delivered }] });
    expect(await code(service.markDelivered(1, {}, actor))).toMatchObject({ status: 409, code: 'courier_delivery_final' });
    expect(repository.rows[0].delivered_at).toBe(delivered);
  });

  test('Two completions at once: one wins, the other gets courier_delivery_final', async () => {
    const { service, repository, transactionalMailer } = setup({ seed: onTheRoad() });
    const results = await Promise.all([
      code(service.markDelivered(1, {}, actor)),
      code(service.markFailed(1, { reason: 'Ninguém em casa' }, actor))
    ]);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(results.find(Boolean)).toMatchObject({ status: 409, code: 'courier_delivery_final' });
    expect(repository.rows[0].status).toBe('delivered');
    expect(repository.rows[0].failure_reason).toBeFalsy();
    expect(transactionalMailer.notifyCourierDelivered).toHaveBeenCalledTimes(1);
  });

  test('cancel closes an out-for-delivery row', async () => {
    const { service, repository } = setup({ seed: onTheRoad() });
    await service.cancel(1, actor);
    expect(repository.rows[0]).toMatchObject({ status: 'canceled', canceled_at: NOW });
  });

  test('an unknown delivery is 404', async () => {
    const { service } = setup();
    expect(await code(service.markDelivered(5, {}, actor))).toMatchObject({ status: 404 });
  });
});

describe('Details can be corrected while not canceled', () => {
  test('Cost corrected after delivery keeps status and delivered date', async () => {
    const delivered = new Date('2026-11-04T13:00:00Z');
    const { service, repository } = setup({ seed: [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'delivered', delivered_at: delivered, cost_minor: 1850 }] });
    await service.updateDetails(1, { cost: '20.00' }, actor);
    expect(repository.rows[0]).toMatchObject({ cost_minor: 2000, status: 'delivered', delivered_at: delivered });
  });

  test('a failed row can be edited too', async () => {
    const { service, repository } = setup({ seed: [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'failed' }] });
    await service.updateDetails(1, { note: 'Cliente pediu outro horário' }, actor);
    expect(repository.rows[0].note).toBe('Cliente pediu outro horário');
  });

  test('Edit a canceled delivery returns 409 and changes nothing', async () => {
    const { service, repository } = setup({ seed: [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'canceled', note: null }] });
    expect(await code(service.updateDetails(1, { note: 'late' }, actor))).toMatchObject({ status: 409, code: 'courier_delivery_final' });
    expect(repository.rows[0].note).toBeNull();
  });

  test('an invalid link on edit returns 422', async () => {
    const { service } = setup({ seed: [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'out_for_delivery' }] });
    expect(await code(service.updateDetails(1, { tracking_url: 'javascript:alert(1)' }, actor))).toMatchObject({ status: 422, details: { field: 'tracking_url' } });
  });
});

describe('Every action is audited', () => {
  test('dispatch, delivered, failed, cancel and update each record the actor and the delivery', async () => {
    const { service, auditService } = setup();
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    await service.markFailed(1, { reason: 'Ninguém em casa' }, actor);
    await service.updateDetails(1, { note: 'x' }, actor);
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    await service.markDelivered(2, {}, actor);
    await service.dispatch({ subscriptionId: '42', body: dispatchBody({ invoice_id: 'in_2' }), actor }).catch(() => {});

    const actions = auditService.record.mock.calls.map(([event]) => event.action);
    expect(actions.slice(0, 5)).toEqual([
      'courier_delivery.dispatch', 'courier_delivery.failed', 'courier_delivery.update', 'courier_delivery.dispatch', 'courier_delivery.delivered'
    ]);
    const failed = auditService.record.mock.calls[1][0];
    expect(failed).toMatchObject({
      actor,
      targetUserId: '7',
      targetEmail: 'ana@example.com',
      metadata: { courierDeliveryId: 1, subscriptionId: '42', invoiceId: 'in_1', status: 'failed', reason: 'Ninguém em casa' }
    });
  });

  test('cancel is audited', async () => {
    const { service, auditService } = setup({ seed: [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'out_for_delivery' }] });
    await service.cancel(1, actor);
    expect(auditService.record.mock.calls[0][0]).toMatchObject({ action: 'courier_delivery.cancel', metadata: { status: 'canceled' } });
  });

  test('nothing is audited when the write is refused', async () => {
    const { service, auditService } = setup({ invoice: paidInvoice({ status: 'open' }) });
    await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }));
    expect(auditService.record).not.toHaveBeenCalled();
  });
});

describe('The queue lists Brazil delivery work in four groups', () => {
  // NOW is 2026-11-04 12:00 in São Paulo.
  const cycle = (invoice, deliveryDate, extra = {}) => ({
    id: 42, stripeSubscriptionId: 'sub_br_1', stripeAccount: 'br', status: 'active', productionStatus: 'ready',
    paidInvoiceId: invoice, deliveryDate, customerEmail: 'ana@example.com',
    address: { country: 'BR', city: 'São Paulo', neighborhood: 'Pinheiros', postal_code: '05422-000', recipient_name: 'João Lima' },
    ...extra
  });
  const delivery = (id, invoice, status, extra = {}) => ({ id, subscription_id: '42', stripe_invoice_id: invoice, status, stripe_account: 'br', out_for_delivery_at: NOW, ...extra });
  const invoices = (group) => group.map((item) => item.invoice_id);

  test('Paid cycle waiting, old paid cycle, recipient and address fields', async () => {
    const { service, ledgerRepository } = setup({ cycles: [cycle('in_new', '2026-11-05'), cycle('in_30', '2026-10-05'), cycle('in_31', '2026-10-04')] });
    const { data } = await service.listQueue(actor);
    expect(ledgerRepository.listPaidCourierCycles.mock.calls[0][0].deliveryFloor).toBe('2026-10-05');
    expect(invoices(data.to_dispatch)).toEqual(['in_new', 'in_30']);
    expect(data.to_dispatch[0]).toMatchObject({
      recipient_name: 'João Lima', neighborhood: 'Pinheiros', city: 'São Paulo', zipcode: '05422-000',
      delivery_date: '2026-11-05', production_status: 'ready', subscription_status: 'active', delivery: null
    });
  });

  test('Long on the road: a delivery whose cycle is 40 days old stays out for delivery', async () => {
    const { service } = setup({
      cycles: [cycle('in_old', '2026-09-25')],
      seed: [delivery(1, 'in_old', 'out_for_delivery')]
    });
    const { data } = await service.listQueue(actor);
    expect(invoices(data.out_for_delivery)).toEqual(['in_old']);
    expect(data.out_for_delivery[0].recipient_name).toBe('João Lima');
    expect(data.to_dispatch).toEqual([]);
  });

  test('Old failure: listed under failed and not under to dispatch', async () => {
    const { service } = setup({
      cycles: [cycle('in_f', '2026-11-01'), cycle('in_f40', '2026-09-25')],
      seed: [delivery(1, 'in_f', 'failed'), delivery(2, 'in_f40', 'failed', { failed_at: new Date('2026-09-25T12:00:00Z') })]
    });
    const { data } = await service.listQueue(actor);
    expect(invoices(data.failed).sort()).toEqual(['in_f', 'in_f40']);
    expect(data.to_dispatch).toEqual([]);
  });

  test('Failed then dispatched again: only under out for delivery', async () => {
    const { service } = setup({
      cycles: [cycle('in_r', '2026-11-03')],
      seed: [delivery(1, 'in_r', 'failed'), delivery(2, 'in_r', 'out_for_delivery')]
    });
    const { data } = await service.listQueue(actor);
    expect(invoices(data.out_for_delivery)).toEqual(['in_r']);
    expect(data.failed).toEqual([]);
    expect(data.to_dispatch).toEqual([]);
  });

  test('two failures of one invoice show the newest once', async () => {
    const { service } = setup({ cycles: [cycle('in_2f', '2026-11-03')], seed: [delivery(1, 'in_2f', 'failed'), delivery(2, 'in_2f', 'failed')] });
    const { data } = await service.listQueue(actor);
    expect(data.failed.map((item) => item.delivery.id)).toEqual([2]);
  });

  test('Delivered window: 6 civil days ago in São Paulo is listed, 7 and 8 are not', async () => {
    const { service, repository } = setup({
      cycles: [cycle('in_d6', '2026-10-29'), cycle('in_d7', '2026-10-28'), cycle('in_d8', '2026-10-27')],
      seed: [
        // 00:30 on 2026-10-29 in São Paulo is 03:30 UTC: the first minutes of the window.
        delivery(1, 'in_d6', 'delivered', { delivered_at: new Date('2026-10-29T03:30:00Z') }),
        // 23:30 on 2026-10-28 in São Paulo is 02:30 UTC on the 29th, but still the 7th day back.
        delivery(2, 'in_d7', 'delivered', { delivered_at: new Date('2026-10-29T02:30:00Z') }),
        delivery(3, 'in_d8', 'delivered', { delivered_at: new Date('2026-10-27T15:00:00Z') })
      ]
    });
    const listDeliveredSince = jest.spyOn(repository, 'listDeliveredSince');
    const { data } = await service.listQueue(actor);
    expect(listDeliveredSince.mock.calls[0][0]).toEqual(new Date('2026-10-29T03:00:00Z'));
    expect(invoices(data.delivered)).toEqual(['in_d6']);
    expect(data.to_dispatch).toEqual([]);
  });

  test('a canceled delivery sends the cycle back to dispatch', async () => {
    const { service } = setup({ cycles: [cycle('in_c', '2026-11-03')], seed: [delivery(1, 'in_c', 'canceled')] });
    const { data } = await service.listQueue(actor);
    expect(invoices(data.to_dispatch)).toEqual(['in_c']);
  });

  test('Old subscription: no recipient shows the production queue name, then the email', async () => {
    const { service } = setup({
      cycles: [
        cycle('in_n', '2026-11-03', { address: { country: 'BR', name: 'Ana Costa' } }),
        cycle('in_e', '2026-11-04', { address: { country: 'BR' } })
      ]
    });
    const { data } = await service.listQueue(actor);
    expect(data.to_dispatch.map((item) => item.recipient_name)).toEqual(['Ana Costa', 'ana@example.com']);
  });

  test('Staff limited to the US gets an empty queue without reading the ledger', async () => {
    const { service, ledgerRepository } = setup({ cycles: [cycle('in_new', '2026-11-05')] });
    const { data } = await service.listQueue({ userId: 5, roles: ['operations'], markets: ['US'] });
    expect(data).toEqual({ to_dispatch: [], out_for_delivery: [], failed: [], delivered: [], truncated: false });
    expect(ledgerRepository.listPaidCourierCycles).not.toHaveBeenCalled();
  });
});

describe('listForSubscription', () => {
  test('lists every delivery newest first with the recipient', async () => {
    const { service } = setup({ seed: [
      { id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'failed', failure_reason: 'Ninguém em casa' },
      { id: 2, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'delivered', failure_reason: null }
    ] });
    const { data } = await service.listForSubscription('42', actor);
    expect(data.recipient_name).toBe('João Lima');
    expect(data.items.map((item) => [item.id, item.status, item.failure_reason])).toEqual([[2, 'delivered', null], [1, 'failed', 'Ninguém em casa']]);
  });
});

describe('courier letters from the service', () => {
  const onTheRoad = () => [{ id: 1, subscription_id: '42', stripe_invoice_id: 'in_1', status: 'out_for_delivery', out_for_delivery_at: new Date('2026-11-04T12:00:00Z') }];

  test('dispatch sends the out-for-delivery letter with the stored row', async () => {
    const { service, transactionalMailer } = setup();
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    expect(transactionalMailer.notifyCourierOutForDelivery).toHaveBeenCalledWith({
      subscription: expect.objectContaining({ stripeSubscriptionId: 'sub_br_1' }),
      delivery: expect.objectContaining({ id: 1, tracking_url: 'https://trip.uber.com/abc123' })
    });
  });

  test('a second attempt after a failure sends a second letter', async () => {
    const { service, transactionalMailer } = setup();
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    await service.markFailed(1, { reason: 'Ninguém em casa' }, actor);
    await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    expect(transactionalMailer.notifyCourierOutForDelivery.mock.calls.map(([input]) => input.delivery.id)).toEqual([1, 2]);
  });

  test('an edit, a failure and a cancel send nothing', async () => {
    const { service, transactionalMailer } = setup({ seed: onTheRoad() });
    await service.updateDetails(1, { note: 'x' }, actor);
    await service.markFailed(1, { reason: 'Ninguém em casa' }, actor);
    const second = setup({ seed: onTheRoad() });
    await second.service.cancel(1, actor);
    expect(transactionalMailer.notifyCourierOutForDelivery).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyCourierDelivered).not.toHaveBeenCalled();
    expect(second.transactionalMailer.notifyCourierDelivered).not.toHaveBeenCalled();
  });

  test('a refused dispatch sends nothing', async () => {
    const { service, transactionalMailer } = setup({ productionStatus: 'in_production' });
    await code(service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor }));
    expect(transactionalMailer.notifyCourierOutForDelivery).not.toHaveBeenCalled();
  });

  test('SMTP down: the delivery keeps its status and the failure is logged', async () => {
    const mailer = { notifyCourierOutForDelivery: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')), notifyCourierDelivered: jest.fn() };
    const { service, repository, logger } = setup({ mailer });
    const result = await service.dispatch({ subscriptionId: '42', body: dispatchBody(), actor });
    expect(result.data.delivery.status).toBe('out_for_delivery');
    expect(repository.rows[0].status).toBe('out_for_delivery');
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ method: 'notifyCourierOutForDelivery', courierDeliveryId: 1 }), expect.any(String));
    expect(mailer.notifyCourierOutForDelivery).toHaveBeenCalledTimes(1);
  });
});
