const { AdminDeliveryCalendarService } = require('../src/services/admin-delivery-calendar.service');
const { DeliveryCalendarImpactService, prepMidnight } = require('../src/services/delivery-calendar-impact.service');
const { buildDeliveryRead } = require('../src/services/customer-deliveries.service');
const { PaidCyclesService } = require('../src/services/paid-cycles.service');
const { DEFAULT_OPERATING_WEEK, TIMEZONE_BR, wallTimeToUtc, weekOf } = require('../src/core/delivery-closed-days');

// November 2026: Tuesday 17, Saturday 21, Monday 23, Tuesday 24. No closed days, so only the week decides.
const br = (y, m, d, h, min = 0) => wallTimeToUtc(y, m, d, h, min, 0, TIMEZONE_BR);
const TUESDAY_NOON = br(2026, 11, 17, 12);
const SATURDAY_10 = br(2026, 11, 21, 10);
const BR = { market: 'BR', markets: ['BR'] };
const IDENTITY = { userId: '7', email: 'op@edenbowls.com' };
const MONDAY_TO_FRIDAY = weekOf([1, 2, 3, 4, 5]);
const MONDAY_TO_SATURDAY = weekOf([1, 2, 3, 4, 5, 6]);

function subscription(id, overrides = {}) {
  return {
    stripeSubscriptionId: id, ledgerId: 1, userId: 70, market: 'BR', status: 'active',
    chargeAt: br(2026, 11, 21, 14, 30), termMonths: 1, chargedCount: null, transitDays: 0,
    productionStatus: 'to_prepare', pendingDeliveryChanges: null, paidCycle: null, ...overrides
  };
}

// A trialing charge at 00:00 of Saturday (after a skip or postpone), a renewal at the purchase time on Saturday,
// a paid Saturday delivery in production, an unpaid one marked ready, and a Tuesday renewal.
const SATURDAY_MIDNIGHT = () => subscription('sub_sat_midnight', { status: 'trialing', chargeAt: br(2026, 11, 21, 0) });
const SATURDAY_1430 = () => subscription('sub_sat_1430');
const SATURDAY_PAID = () => subscription('sub_sat_paid', {
  chargeAt: br(2026, 12, 15, 10), chargedCount: 0, currentPaid: true,
  paidCycle: { status: 'in_production', preparationDay: '2026-11-21', deliveryDate: '2026-11-21' }
});
const SATURDAY_READY = () => subscription('sub_sat_ready', { productionStatus: 'ready' });
const TUESDAY = () => subscription('sub_tue', { chargeAt: br(2026, 11, 24, 10) });

function setup({ subscriptions = [SATURDAY_MIDNIGHT(), SATURDAY_1430(), SATURDAY_PAID(), TUESDAY()], week = DEFAULT_OPERATING_WEEK, now = TUESDAY_NOON } = {}) {
  const manager = { query: jest.fn() };
  const stored = { ...week };
  const calendarRepository = {
    snapshot: jest.fn(async () => ({ rows: [], week: { ...stored } })),
    listActive: jest.fn().mockResolvedValue([])
  };
  const weekRepository = {
    get: jest.fn(async (market) => stored[market]),
    saveIn: jest.fn(async (_manager, market, days) => {
      stored[market] = days;
      return days;
    })
  };
  const syncsRepository = { insertPending: jest.fn().mockResolvedValueOnce(501).mockResolvedValueOnce(502), linkAuditEvent: jest.fn() };
  const auditRepository = { createIn: jest.fn().mockResolvedValue(9001) };
  const ledgerRepository = { rewritePendingChargeMove: jest.fn().mockResolvedValue({}) };
  const service = new AdminDeliveryCalendarService({
    calendarRepository,
    weekRepository,
    impactService: new DeliveryCalendarImpactService({ subscriptions: { listForMarket: jest.fn().mockResolvedValue(subscriptions) }, now: () => now }),
    syncsRepository,
    ledgerRepository,
    auditRepository,
    dataSource: { transaction: jest.fn((work) => work(manager)) },
    now: () => now
  });
  return { service, manager, stored, weekRepository, syncsRepository, auditRepository, ledgerRepository };
}

const byId = (impact) => Object.fromEntries(impact.map((item) => [item.stripeSubscriptionId, item]));

describe('a proposed week is valid before it is stored', () => {
  test('Closing before opening', async () => {
    const { service, weekRepository } = setup();
    const days = MONDAY_TO_FRIDAY.map((day) => (day.weekday === 1 ? { ...day, opensAt: '20:00', closesAt: '09:00' } : day));
    await expect(service.previewWeek({ marketQuery: BR, body: { days } })).rejects.toMatchObject({ statusCode: 422, details: { code: 'invalid_week_hours' } });
    await expect(service.saveWeek({ marketQuery: BR, body: { days, confirmedMoves: [] } })).rejects.toMatchObject({ details: { code: 'invalid_week_hours' } });
    expect(weekRepository.saveIn).not.toHaveBeenCalled();
  });

  test('a time that is not HH:MM and a week without seven days are refused', async () => {
    const { service } = setup();
    const bad = MONDAY_TO_FRIDAY.map((day) => (day.weekday === 2 ? { ...day, closesAt: '24:00' } : day));
    await expect(service.previewWeek({ marketQuery: BR, body: { days: bad } })).rejects.toMatchObject({ details: { code: 'invalid_week_hours' } });
    await expect(service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY.slice(1) } })).rejects.toMatchObject({ details: { code: 'invalid_week_hours' } });
  });

  test('No day can prepare in the United States', async () => {
    const { service, weekRepository } = setup({ subscriptions: [] });
    const days = weekOf([5, 6]);
    await expect(service.saveWeek({ marketQuery: { market: 'US', markets: ['US'] }, body: { days, confirmedMoves: [] } }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'week_without_preparation' } });
    await expect(service.previewWeek({ marketQuery: BR, body: { days: weekOf([]) } }))
      .rejects.toMatchObject({ details: { code: 'week_without_preparation' } });
    expect(weekRepository.saveIn).not.toHaveBeenCalled();
    // An open Sunday reaches a Monday pickup, so it is a valid United States week.
    await expect(service.previewWeek({ marketQuery: { market: 'US', markets: ['US'] }, body: { days: weekOf([7]) } })).resolves.toMatchObject({ market: 'US' });
  });
});

describe('every change of the week is previewed', () => {
  test('Closing Saturday in Brazil', async () => {
    const { service, weekRepository } = setup();
    const preview = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY } });
    const items = byId(preview.impact);

    expect(Object.keys(items).sort()).toEqual(['sub_sat_1430', 'sub_sat_midnight', 'sub_sat_paid']);
    expect(items.sub_sat_midnight).toMatchObject({
      preparationDay: '2026-11-21', newPreparationDay: '2026-11-23', outcome: 'moved', move: 'stripe_sync',
      targetTrialEnd: prepMidnight('2026-11-23', TIMEZONE_BR).toISOString()
    });
    expect(items.sub_sat_1430).toMatchObject({ preparationDay: '2026-11-21', newPreparationDay: '2026-11-23', outcome: 'moved', move: 'projection_only' });
    expect(items.sub_sat_paid).toMatchObject({ preparationDay: '2026-11-21', newPreparationDay: '2026-11-21', outcome: 'kept', lockReason: 'paid' });
    expect(preview.confirmedMoves).toEqual([
      { stripeSubscriptionId: 'sub_sat_midnight', deliveryId: 'current', newPreparationDay: '2026-11-23' },
      { stripeSubscriptionId: 'sub_sat_1430', deliveryId: 'current', newPreparationDay: '2026-11-23' }
    ]);
    expect(preview.before).toEqual(MONDAY_TO_SATURDAY);
    expect(weekRepository.saveIn).not.toHaveBeenCalled();
  });

  test('Unpaid delivery past the edit deadline', async () => {
    const { service } = setup({ subscriptions: [SATURDAY_1430()], now: SATURDAY_10 });
    const { impact, confirmedMoves } = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY } });
    expect(impact).toEqual([expect.objectContaining({
      stripeSubscriptionId: 'sub_sat_1430', outcome: 'moved_charge_kept', lockReason: 'past_editable_until', move: 'projection_only',
      chargeAt: br(2026, 11, 21, 14, 30).toISOString(), preparationDay: '2026-11-21', newPreparationDay: '2026-11-23'
    })]);
    expect(confirmedMoves).toEqual([{ stripeSubscriptionId: 'sub_sat_1430', deliveryId: 'current', newPreparationDay: '2026-11-23' }]);
  });

  test('Changing only the hours', async () => {
    const tuesday1430 = subscription('sub_tue_1430', { chargeAt: br(2026, 11, 24, 14, 30) });
    const { service } = setup({ subscriptions: [SATURDAY_MIDNIGHT(), tuesday1430] });
    const { impact } = await service.previewWeek({ marketQuery: BR, body: { days: weekOf([1, 2, 3, 4, 5, 6], '09:00', '14:00') } });
    expect(impact).toEqual([expect.objectContaining({
      stripeSubscriptionId: 'sub_tue_1430', preparationDay: '2026-11-24', newPreparationDay: '2026-11-25', outcome: 'moved', move: 'projection_only'
    })]);
  });

  test('Opening a weekday', async () => {
    const saturday10 = subscription('sub_sat_10', { chargeAt: br(2026, 11, 21, 10) });
    const { service } = setup({ subscriptions: [saturday10], week: { ...DEFAULT_OPERATING_WEEK, BR: MONDAY_TO_FRIDAY } });
    const { impact } = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_SATURDAY } });
    expect(impact).toEqual([expect.objectContaining({ preparationDay: '2026-11-23', newPreparationDay: '2026-11-21', outcome: 'moved', move: 'projection_only' })]);
  });

  test('Nothing changes', async () => {
    const { service } = setup();
    const preview = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_SATURDAY } });
    expect(preview.impact).toEqual([]);
    expect(preview.confirmedMoves).toEqual([]);
  });
});

describe('saving the week applies the previewed impact', () => {
  test('Save after preview', async () => {
    const { service, manager, weekRepository, syncsRepository, auditRepository } = setup();
    const preview = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY } });

    const saved = await service.saveWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY, confirmedMoves: preview.confirmedMoves }, identity: IDENTITY });

    expect(weekRepository.saveIn).toHaveBeenCalledWith(manager, 'BR', MONDAY_TO_FRIDAY);
    expect(syncsRepository.insertPending).toHaveBeenCalledTimes(1);
    expect(syncsRepository.insertPending).toHaveBeenCalledWith(manager, {
      stripeSubscriptionId: 'sub_sat_midnight',
      market: 'BR',
      expectedTrialEnd: br(2026, 11, 21, 0).toISOString(),
      targetTrialEnd: prepMidnight('2026-11-23', TIMEZONE_BR).toISOString()
    });
    const [, event] = auditRepository.createIn.mock.calls[0];
    expect(event).toMatchObject({ actorUserId: '7', actorEmail: 'op@edenbowls.com', action: 'delivery_calendar.week_update' });
    expect(event.metadata).toMatchObject({ market: 'BR', before: MONDAY_TO_SATURDAY, after: MONDAY_TO_FRIDAY, syncIds: [501] });
    expect(event.metadata.impact.map((item) => [item.stripeSubscriptionId, item.outcome]).sort()).toEqual([
      ['sub_sat_1430', 'moved'], ['sub_sat_midnight', 'moved'], ['sub_sat_paid', 'kept']
    ]);
    expect(syncsRepository.linkAuditEvent).toHaveBeenCalledWith(manager, [501], 9001);
    expect(saved).toMatchObject({ market: 'BR', days: MONDAY_TO_FRIDAY, syncIds: [501], auditEventId: 9001 });
  });

  test('The impact changed after the preview', async () => {
    const { service, weekRepository, syncsRepository, auditRepository } = setup();
    const preview = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY } });
    const stale = preview.confirmedMoves.slice(0, 1);

    await expect(service.saveWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY, confirmedMoves: stale }, identity: IDENTITY }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'week_impact_changed', confirmedMoves: preview.confirmedMoves } });
    expect(weekRepository.saveIn).not.toHaveBeenCalled();
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
    expect(auditRepository.createIn).not.toHaveBeenCalled();
  });

  test('Paid or in-production delivery does not block the save', async () => {
    const { service, weekRepository, syncsRepository } = setup({ subscriptions: [SATURDAY_PAID(), SATURDAY_READY()] });
    const preview = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY } });
    expect(preview.impact.map((item) => [item.stripeSubscriptionId, item.outcome, item.newPreparationDay])).toEqual([
      ['sub_sat_paid', 'kept', '2026-11-21'],
      ['sub_sat_ready', 'kept', '2026-11-21']
    ]);
    expect(preview.confirmedMoves).toEqual([]);

    await service.saveWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY, confirmedMoves: [] }, identity: IDENTITY });
    expect(weekRepository.saveIn).toHaveBeenCalled();
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
  });

  test('Unpaid delivery past the edit deadline after the save', async () => {
    const renewal = SATURDAY_1430();
    const { service, stored, syncsRepository, ledgerRepository } = setup({ subscriptions: [renewal], now: SATURDAY_10 });
    const preview = await service.previewWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY } });
    await service.saveWeek({ marketQuery: BR, body: { days: MONDAY_TO_FRIDAY, confirmedMoves: preview.confirmedMoves }, identity: IDENTITY });
    expect(syncsRepository.insertPending).not.toHaveBeenCalled();
    expect(ledgerRepository.rewritePendingChargeMove).not.toHaveBeenCalled();

    const calendar = { snapshot: async () => ({ rows: [], week: { ...stored } }) };
    // The customer's deliveries.
    const read = buildDeliveryRead({ ...renewal, rows: await calendar.snapshot(), now: SATURDAY_10 });
    expect(read.delivery.preparationDay).toBe('2026-11-23');
    // The paid cycle and the production queue row, with Stripe charging on Saturday at 14:30 as before.
    const markPaid = jest.fn(async (input) => input);
    const paidCycles = new PaidCyclesService({ productionRepository: { markPaid }, calendar });
    const ledgerRow = { id: 42, stripeAccount: 'br', address: { country: 'BR' }, shipping: { distance: 10 } };
    const invoice = { id: 'in_sat', status_transitions: { paid_at: Math.floor(br(2026, 11, 21, 14, 35).getTime() / 1000) } };
    await expect(paidCycles.estimateFor({ ledgerRow, invoice })).resolves.toMatchObject({ preparationDay: '2026-11-23' });
    await paidCycles.recordPaid({ ledgerRow, subscription: { current_period_start: Math.floor(renewal.chargeAt.getTime() / 1000) }, invoice });
    expect(markPaid).toHaveBeenCalledWith(expect.objectContaining({ periodEnd: renewal.chargeAt, preparationDay: '2026-11-23', deliveryDate: '2026-11-23' }));
  });
});
