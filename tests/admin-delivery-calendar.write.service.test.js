const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');
const { DeliveryCalendarImpactService, prepMidnight } = require('../src/services/delivery-calendar-impact.service');

const NOW = new Date('2027-12-10T15:00:00Z');
const TZ = 'America/New_York';
const US = { market: 'US', markets: ['US'] };
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

function subscription(overrides = {}) {
  return {
    stripeSubscriptionId: 'sub_1', ledgerId: 1, userId: 70, market: 'US', status: 'active',
    chargeAt: new Date('2027-12-20T15:00:00Z'), termMonths: 1, chargedCount: null, transitDays: 1,
    productionStatus: 'to_prepare', pendingDeliveryChanges: null, paidCycle: null, ...overrides
  };
}

function setup({ subscriptions = [subscription()], existing = [], insertError = null, syncError = null, auditError = null } = {}) {
  const manager = { query: jest.fn() };
  const calendarRepository = {
    listActive: jest.fn().mockResolvedValue(existing.filter((row) => row.active)),
    listYear: jest.fn().mockResolvedValue(existing),
    findById: jest.fn(async (id) => existing.find((row) => row.id === id) || null),
    insertRow: insertError ? jest.fn().mockRejectedValue(insertError) : jest.fn(async (_m, row) => ({ ...row, id: 99 })),
    updateRow: jest.fn(async (_m, row) => row),
    deleteRow: jest.fn()
  };
  const syncsRepository = {
    insertPending: syncError ? jest.fn().mockRejectedValue(syncError) : jest.fn().mockResolvedValueOnce(501).mockResolvedValueOnce(502),
    linkAuditEvent: jest.fn()
  };
  const auditRepository = { createIn: auditError ? jest.fn().mockRejectedValue(auditError) : jest.fn().mockResolvedValue(9001) };
  const ledgerRepository = { rewritePendingChargeMove: jest.fn().mockResolvedValue({}) };
  const listForMarket = jest.fn().mockResolvedValue(subscriptions);
  const dataSource = { transaction: jest.fn((work) => work(manager)) };
  const service = new AdminDeliveryCalendarService({
    calendarRepository,
    impactService: new DeliveryCalendarImpactService({ subscriptions: { listForMarket }, now: () => NOW }),
    syncsRepository,
    ledgerRepository,
    auditRepository,
    dataSource,
    now: () => NOW
  });
  return { service, manager, calendarRepository, syncsRepository, ledgerRepository, auditRepository, dataSource, listForMarket };
}

const adhoc = (closedOn, flags = {}) => ({
  type: 'adhoc', label: 'Manutenção', closedOn, closesPreparation: true, closesPickup: true, closesDelivery: true, ...flags
});

describe('AdminDeliveryCalendarService.write', () => {
  test('a closure stores the row and queues a sync for a trialing charge, inside one transaction', async () => {
    const chargeAt = prepMidnight('2027-12-21', TZ);
    const { service, manager, calendarRepository, syncsRepository, ledgerRepository, dataSource } = setup({
      subscriptions: [subscription(), subscription({ stripeSubscriptionId: 'sub_2', status: 'trialing', chargeAt })]
    });
    const result = await service.write({ marketQuery: US, body: adhoc('2027-12-21') });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(calendarRepository.insertRow).toHaveBeenCalledWith(manager, expect.objectContaining({ type: 'adhoc', origin: 'one_off', closedOn: '2027-12-21' }));
    expect(syncsRepository.insertPending).toHaveBeenCalledTimes(1);
    expect(syncsRepository.insertPending).toHaveBeenCalledWith(manager, {
      stripeSubscriptionId: 'sub_2',
      market: 'US',
      expectedTrialEnd: chargeAt.toISOString(),
      targetTrialEnd: prepMidnight('2027-12-22', TZ).toISOString()
    });
    expect(ledgerRepository.rewritePendingChargeMove).not.toHaveBeenCalled();
    expect(result.syncIds).toEqual([501]);
    expect(result.affected.map((item) => item.move)).toEqual(['projection_only', 'stripe_sync']);
  });

  test('a renewal at the end of its period moves with no sync and nothing stored for it', async () => {
    const { service, syncsRepository, ledgerRepository } = setup();
    const result = await service.write({ marketQuery: US, body: adhoc('2027-12-21') });
    expect(result.affected).toEqual([expect.objectContaining({ move: 'projection_only', newPreparationDay: '2027-12-22' })]);
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
    expect(ledgerRepository.rewritePendingChargeMove).not.toHaveBeenCalled();
  });

  test('a pending charge move is rewritten in the transaction and gets no sync', async () => {
    const pendingAt = prepMidnight('2027-12-21', TZ);
    const { service, manager, syncsRepository, ledgerRepository } = setup({
      subscriptions: [subscription({
        chargeAt: new Date('2027-12-10T20:00:00Z'),
        termMonths: 3,
        chargedCount: 1,
        pendingDeliveryChanges: { charge_move: { kind: 'reschedule', trial_end: unix(pendingAt.toISOString()) } }
      })]
    });
    await service.write({ marketQuery: US, body: adhoc('2027-12-21') });
    expect(ledgerRepository.rewritePendingChargeMove).toHaveBeenCalledWith(manager, 'sub_1', {
      previous: unix(pendingAt.toISOString()),
      next: unix(prepMidnight('2027-12-22', TZ).toISOString())
    });
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
  });

  test('a locked delivery refuses the closure, names it, and stores nothing', async () => {
    const { service, calendarRepository, syncsRepository } = setup({ subscriptions: [subscription({ productionStatus: 'ready' })] });
    await expect(service.write({ marketQuery: US, body: adhoc('2027-12-21') })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'delivery_locked', subscriptions: [{ stripeSubscriptionId: 'sub_1', deliveryId: 'current', lockReason: 'ready' }] }
    });
    expect(calendarRepository.insertRow).not.toHaveBeenCalled();
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
  });

  test('a delivery locked after the preview is caught on confirm', async () => {
    const live = subscription();
    const { service, listForMarket, calendarRepository } = setup({ subscriptions: [live] });
    const preview = await service.preview({ marketQuery: US, body: adhoc('2027-12-21') });
    expect(preview.affected[0].locked).toBe(false);
    listForMarket.mockResolvedValue([{ ...live, productionStatus: 'in_production' }]);
    await expect(service.write({ marketQuery: US, body: adhoc('2027-12-21') })).rejects.toMatchObject({ details: { code: 'delivery_locked' } });
    expect(calendarRepository.insertRow).not.toHaveBeenCalled();
  });

  test('a failed step fails the whole transaction', async () => {
    const chargeAt = prepMidnight('2027-12-21', TZ);
    const { service } = setup({
      subscriptions: [subscription({ status: 'trialing', chargeAt })],
      syncError: new Error('insert failed')
    });
    await expect(service.write({ marketQuery: US, body: adhoc('2027-12-21') })).rejects.toThrow('insert failed');
  });

  test('Stripe is never called: an unavailable Stripe does not stop the save', async () => {
    const chargeAt = prepMidnight('2027-12-21', TZ);
    const { service, syncsRepository } = setup({ subscriptions: [subscription({ status: 'trialing', chargeAt })] });
    const result = await service.write({ marketQuery: US, body: adhoc('2027-12-21') });
    expect(result.syncIds).toEqual([501]);
    expect(syncsRepository.insertPending).toHaveBeenCalled();
  });

  test('validation: one flag at least, no national, no carrier in Brazil, one row per type and date', async () => {
    const twin = { id: 1, market: 'US', closedOn: '2027-12-21', type: 'adhoc', active: false };
    const { service } = setup({ existing: [twin] });
    await expect(service.write({ marketQuery: US, body: adhoc('2027-12-22', { closesPreparation: false, closesPickup: false, closesDelivery: false }) }))
      .rejects.toMatchObject({ details: { code: 'flag_required' } });
    await expect(service.write({ marketQuery: US, body: { ...adhoc('2027-12-22'), type: 'national' } }))
      .rejects.toMatchObject({ details: { code: 'type_not_allowed' } });
    await expect(service.write({ marketQuery: { market: 'BR' }, body: { ...adhoc('2027-12-22'), type: 'carrier' } }))
      .rejects.toMatchObject({ details: { code: 'type_not_allowed' } });
    await expect(service.write({ marketQuery: US, body: adhoc('2027-12-21') }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'closed_day_conflict' } });
  });

  test('a duplicate caught by the unique key is a conflict', async () => {
    const { service } = setup({ insertError: Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' }) });
    await expect(service.write({ marketQuery: US, body: adhoc('2027-12-28') })).rejects.toMatchObject({ details: { code: 'closed_day_conflict' } });
  });

  test('reactivating a row follows the closure rule', async () => {
    const row = { id: 4, market: 'US', closedOn: '2027-12-21', label: 'Manutenção', origin: 'one_off', type: 'adhoc', active: false, closesPreparation: true, closesPickup: true, closesDelivery: true };
    const { service, calendarRepository } = setup({ existing: [row], subscriptions: [subscription({ productionStatus: 'blocked' })] });
    await expect(service.write({ marketQuery: US, body: { id: 4, active: true } })).rejects.toMatchObject({ details: { code: 'delivery_locked' } });
    expect(calendarRepository.updateRow).not.toHaveBeenCalled();
  });
});

describe('opening a day leaves scheduled deliveries alone', () => {
  const row = { id: 4, market: 'US', closedOn: '2027-12-21', label: 'Manutenção', origin: 'one_off', type: 'adhoc', active: true, closesPreparation: true, closesPickup: true, closesDelivery: true };
  const trialing = () => subscription({ status: 'trialing', chargeAt: prepMidnight('2027-12-22', TZ) });

  function expectNothingMoved({ listForMarket, syncsRepository, ledgerRepository }) {
    expect(listForMarket).not.toHaveBeenCalled();
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
    expect(ledgerRepository.rewritePendingChargeMove).not.toHaveBeenCalled();
  }

  test('deactivation', async () => {
    const context = setup({ existing: [row], subscriptions: [trialing()] });
    const result = await context.service.write({ marketQuery: US, body: { id: 4, active: false } });
    expect(context.calendarRepository.updateRow).toHaveBeenCalledWith(context.manager, expect.objectContaining({ id: 4, active: false }));
    expect(result.affected).toEqual([]);
    expectNothingMoved(context);
  });

  test('turning a flag off', async () => {
    const context = setup({ existing: [row], subscriptions: [trialing()] });
    await context.service.write({ marketQuery: US, body: { id: 4, closesPickup: false } });
    expect(context.calendarRepository.updateRow).toHaveBeenCalledWith(context.manager, expect.objectContaining({ closesPickup: false, closesDelivery: true }));
    expectNothingMoved(context);
  });

  test('removal, refused for a national holiday', async () => {
    const national = { ...row, id: 5, type: 'national', origin: 'fixed', market: 'US' };
    const context = setup({ existing: [row, national], subscriptions: [trialing()] });
    await context.service.remove({ marketQuery: US, id: 4 });
    expect(context.calendarRepository.deleteRow).toHaveBeenCalledWith(context.manager, 4);
    expectNothingMoved(context);
    await expect(context.service.remove({ marketQuery: US, id: 5 })).rejects.toMatchObject({ details: { code: 'national_not_removable' } });
    await expect(context.service.remove({ marketQuery: { market: 'BR' }, id: 4 })).rejects.toMatchObject({ statusCode: 403 });
    expect(context.calendarRepository.deleteRow).toHaveBeenCalledTimes(1);
  });

  test('the last flag cannot be turned off', async () => {
    const pickupOnly = { ...row, closesPreparation: false, closesDelivery: false };
    const context = setup({ existing: [pickupOnly] });
    await expect(context.service.write({ marketQuery: US, body: { id: 4, closesPickup: false } }))
      .rejects.toMatchObject({ details: { code: 'flag_required' } });
    expect(context.calendarRepository.updateRow).not.toHaveBeenCalled();
  });
});

describe('every calendar change is audited in its transaction', () => {
  const IDENTITY = { userId: '7', email: 'op@edenbowls.com' };
  const row = { id: 4, market: 'US', closedOn: '2027-12-21', label: 'Manutenção', origin: 'one_off', type: 'adhoc', active: true, closesPreparation: true, closesPickup: true, closesDelivery: true };

  test('create records the actor, no previous value, the new flags, and the moved subscriptions; syncs are linked', async () => {
    const chargeAt = prepMidnight('2027-12-21', TZ);
    const context = setup({ subscriptions: [subscription(), subscription({ stripeSubscriptionId: 'sub_2', status: 'trialing', chargeAt })] });
    const result = await context.service.write({ marketQuery: US, body: adhoc('2027-12-21'), identity: IDENTITY });
    expect(context.auditRepository.createIn).toHaveBeenCalledWith(context.manager, {
      actorUserId: '7',
      actorEmail: 'op@edenbowls.com',
      action: 'delivery_calendar.create',
      metadata: {
        market: 'US',
        closedOn: '2027-12-21',
        type: 'adhoc',
        label: 'Manutenção',
        before: null,
        after: { active: true, closesPreparation: true, closesPickup: true, closesDelivery: true },
        moved: [
          { stripeSubscriptionId: 'sub_1', deliveryId: 'current', previousPreparationDay: '2027-12-21', newPreparationDay: '2027-12-22', move: 'projection_only' },
          { stripeSubscriptionId: 'sub_2', deliveryId: 'current', previousPreparationDay: '2027-12-21', newPreparationDay: '2027-12-22', move: 'stripe_sync' }
        ],
        syncIds: [501]
      }
    });
    expect(context.syncsRepository.linkAuditEvent).toHaveBeenCalledWith(context.manager, [501], 9001);
    expect(result.auditEventId).toBe(9001);
  });

  test('a pending change is audited with its previous and new trial_end', async () => {
    const pendingAt = prepMidnight('2027-12-21', TZ);
    const context = setup({
      subscriptions: [subscription({
        chargeAt: new Date('2027-12-10T20:00:00Z'), termMonths: 3, chargedCount: 1,
        pendingDeliveryChanges: { charge_move: { kind: 'reschedule', trial_end: unix(pendingAt.toISOString()) } }
      })]
    });
    await context.service.write({ marketQuery: US, body: adhoc('2027-12-21'), identity: IDENTITY });
    const [, event] = context.auditRepository.createIn.mock.calls[0];
    expect(event.metadata.moved).toEqual([expect.objectContaining({
      move: 'pending_change',
      pendingTrialEnd: { previous: pendingAt.toISOString(), next: prepMidnight('2027-12-22', TZ).toISOString() }
    })]);
  });

  test.each([
    [{ id: 4, active: false }, 'delivery_calendar.deactivate', { active: false }],
    [{ id: 4, closesPickup: false }, 'delivery_calendar.update', { closesPickup: false }]
  ])('%j is recorded as %s with before and after', async (body, action, changed) => {
    const context = setup({ existing: [row] });
    await context.service.write({ marketQuery: US, body, identity: IDENTITY });
    const [, event] = context.auditRepository.createIn.mock.calls[0];
    expect(event.action).toBe(action);
    expect(event.metadata.before).toEqual({ active: true, closesPreparation: true, closesPickup: true, closesDelivery: true });
    expect(event.metadata.after).toEqual({ ...event.metadata.before, ...changed });
  });

  test('activation is recorded as activate', async () => {
    const context = setup({ existing: [{ ...row, active: false }], subscriptions: [] });
    await context.service.write({ marketQuery: US, body: { id: 4, active: true }, identity: IDENTITY });
    expect(context.auditRepository.createIn.mock.calls[0][1].action).toBe('delivery_calendar.activate');
  });

  test('removal keeps the date, type, label, and previous flags, and is written before the delete', async () => {
    const context = setup({ existing: [{ ...row, type: 'regional', origin: 'regional' }] });
    const order = [];
    context.auditRepository.createIn.mockImplementation(async () => { order.push('audit'); return 9002; });
    context.calendarRepository.deleteRow.mockImplementation(async () => { order.push('delete'); });
    await context.service.remove({ marketQuery: US, id: 4, identity: IDENTITY });
    const [, event] = context.auditRepository.createIn.mock.calls[0];
    expect(event).toMatchObject({
      action: 'delivery_calendar.remove',
      metadata: { closedOn: '2027-12-21', type: 'regional', label: 'Manutenção', after: null, before: { closesPickup: true } }
    });
    expect(order).toEqual(['audit', 'delete']);
  });

  test('a refused change records no event, and a failed audit fails the change', async () => {
    const locked = setup({ subscriptions: [subscription({ productionStatus: 'ready' })] });
    await expect(locked.service.write({ marketQuery: US, body: adhoc('2027-12-21'), identity: IDENTITY })).rejects.toMatchObject({ statusCode: 409 });
    expect(locked.auditRepository.createIn).not.toHaveBeenCalled();
    const failing = setup({ auditError: new Error('audit down') });
    await expect(failing.service.write({ marketQuery: US, body: adhoc('2027-12-21'), identity: IDENTITY })).rejects.toThrow('audit down');
  });
});

