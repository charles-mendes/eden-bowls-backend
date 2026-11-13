const { subscriptionAlerts } = require('../src/core/customer-subscription-alerts');

const NOW = new Date('2026-11-09T15:00:00.000Z');

function cycle(extra = {}) {
  return {
    invoiceId: 'in_1',
    paidAt: '2026-11-07T12:00:00.000Z',
    preparationDay: '2026-11-08',
    deliveryDate: '2026-11-12',
    production: { status: 'in_production', note: null },
    delivery: { kind: 'courier', id: 5, status: 'delivered', outForDeliveryAt: null, deliveredAt: '2026-11-08T15:00:00.000Z', failedAt: null },
    nfe: { id: 3, number: '1', series: '1', status: 'authorized', lastError: null, emailStatus: 'sent' },
    ...extra
  };
}

function alertsOf(latestCycle, { stripeAccount = 'br', row = {}, now = NOW, unavailable = false } = {}) {
  const item = unavailable ? { stripeAccount, latestCycleUnavailable: true } : { stripeAccount, latestCycle };
  return subscriptionAlerts({ item, row, now });
}

const codes = (alerts) => alerts.map((alert) => alert.code);

describe('subscriptionAlerts', () => {
  test('no problems → no alerts', () => {
    expect(alertsOf(cycle())).toEqual([]);
  });

  test('latest cycle unavailable → only pending_change', () => {
    expect(alertsOf(null, { unavailable: true, row: { editPending: { invoice_id: 'in_9' } } }))
      .toEqual([{ code: 'pending_change', kinds: ['edit'] }]);
  });

  test('null latest cycle → only pending_change can appear', () => {
    expect(alertsOf(null)).toEqual([]);
  });

  describe('NF-e', () => {
    test('rejected note raises nfe_problem with its error', () => {
      expect(alertsOf(cycle({ nfe: { id: 3, status: 'rejected', lastError: 'CPF inválido' } })))
        .toEqual([{ code: 'nfe_problem', nfeId: 3, status: 'rejected', lastError: 'CPF inválido' }]);
    });

    test.each(['error', 'blocked_missing_document'])('%s raises nfe_problem right away', (status) => {
      const paidNow = cycle({ paidAt: NOW.toISOString(), nfe: { id: 4, status, lastError: null } });
      expect(alertsOf(paidNow)).toEqual([{ code: 'nfe_problem', nfeId: 4, status, lastError: null }]);
    });

    test('no note 48h after payment raises nfe_missing', () => {
      expect(alertsOf(cycle({ nfe: null })))
        .toEqual([{ code: 'nfe_missing', status: null, paidAt: '2026-11-07T12:00:00.000Z' }]);
    });

    test('pending note paid an hour ago raises nothing', () => {
      const recent = cycle({ paidAt: '2026-11-09T14:00:00.000Z', nfe: { id: 3, status: 'pending', lastError: null } });
      expect(alertsOf(recent)).toEqual([]);
    });

    test('the 24h limit counts from the paid date', () => {
      const atLimit = cycle({ paidAt: '2026-11-08T15:00:00.000Z', nfe: { id: 3, status: 'submitted', lastError: null } });
      expect(codes(alertsOf(atLimit))).toEqual(['nfe_missing']);
      const justBefore = cycle({ paidAt: '2026-11-08T15:00:01.000Z', nfe: null });
      expect(alertsOf(justBefore)).toEqual([]);
    });

    test('no paid date raises no nfe_missing', () => {
      expect(alertsOf(cycle({ paidAt: null, nfe: null }))).toEqual([]);
    });

    test('a US subscription (no nfe key) raises no NF-e alert', () => {
      const { nfe: _nfe, ...us } = cycle({ nfe: null });
      expect(alertsOf(us, { stripeAccount: 'us' })).toEqual([]);
    });
  });

  describe('delivery_failed', () => {
    test('latest courier attempt failed', () => {
      const failed = cycle({ delivery: { kind: 'courier', id: 8, status: 'failed', failedAt: '2026-11-08T18:00:00.000Z' } });
      expect(alertsOf(failed)).toEqual([{ code: 'delivery_failed', courierDeliveryId: 8, failedAt: '2026-11-08T18:00:00.000Z' }]);
    });

    test('failed then delivered (the shown attempt is delivered) raises nothing', () => {
      expect(alertsOf(cycle())).toEqual([]);
    });
  });

  describe('ready_not_dispatched', () => {
    const ready = (deliveryDate, delivery = null) => cycle({ production: { status: 'ready', note: null }, delivery, deliveryDate });

    test('ready on the delivery day in São Paulo', () => {
      expect(alertsOf(ready('2026-11-09'))).toEqual([{ code: 'ready_not_dispatched', deliveryDate: '2026-11-09' }]);
    });

    test('ready past the delivery date', () => {
      expect(codes(alertsOf(ready('2026-11-05')))).toEqual(['ready_not_dispatched']);
    });

    test('ready ahead of time raises nothing', () => {
      expect(alertsOf(ready('2026-11-10'))).toEqual([]);
    });

    test('ready and on the road raises nothing', () => {
      expect(alertsOf(ready('2026-11-09', { kind: 'courier', id: 5, status: 'out_for_delivery' }))).toEqual([]);
    });

    test('ready with an active UPS label raises nothing', () => {
      expect(alertsOf(ready('2026-11-09', { kind: 'ups', id: 2, status: 'created', trackingNumber: '1Z' }), { stripeAccount: 'us' })).toEqual([]);
    });

    test('without a delivery date raises nothing', () => {
      expect(alertsOf(ready(null))).toEqual([]);
    });

    test('the day turns in São Paulo at 03:00 UTC', () => {
      // 2026-11-10 02:30 UTC is still 2026-11-09 in São Paulo (UTC-3).
      expect(alertsOf(ready('2026-11-10'), { now: new Date('2026-11-10T02:30:00.000Z') })).toEqual([]);
      expect(codes(alertsOf(ready('2026-11-10'), { now: new Date('2026-11-10T03:30:00.000Z') }))).toEqual(['ready_not_dispatched']);
    });

    test('the day turns in New York at 05:00 UTC in November', () => {
      // 2026-11-10 04:30 UTC is still 2026-11-09 in New York (UTC-5).
      const usReady = (date) => { const { nfe: _nfe, ...rest } = ready(date); return rest; };
      expect(alertsOf(usReady('2026-11-10'), { stripeAccount: 'us', now: new Date('2026-11-10T04:30:00.000Z') })).toEqual([]);
      expect(codes(alertsOf(usReady('2026-11-10'), { stripeAccount: 'us', now: new Date('2026-11-10T05:30:00.000Z') }))).toEqual(['ready_not_dispatched']);
    });

    test('an actor without production.read or shipping.read gets no ready alert', () => {
      const { production: _production, ...noProduction } = ready('2026-11-09');
      expect(alertsOf(noProduction)).toEqual([]);
      const { delivery: _delivery, ...noShipping } = ready('2026-11-09');
      expect(alertsOf(noShipping)).toEqual([]);
    });
  });

  describe('pending_change', () => {
    test('pending delivery change only', () => {
      expect(alertsOf(cycle(), { row: { pendingDeliveryChanges: { charge_move: { trial_end: 1 } } } }))
        .toEqual([{ code: 'pending_change', kinds: ['delivery'] }]);
    });

    test('both pending, edit first', () => {
      expect(alertsOf(cycle(), { row: { editPending: { invoice_id: 'in_9' }, pendingDeliveryChanges: { packs: [1] } } }))
        .toEqual([{ code: 'pending_change', kinds: ['edit', 'delivery'] }]);
    });

    test('an emptied pending delivery change raises nothing', () => {
      expect(alertsOf(cycle(), { row: { editPending: null, pendingDeliveryChanges: {} } })).toEqual([]);
      expect(alertsOf(cycle(), { row: { pendingDeliveryChanges: { packs: null, charge_move: null } } })).toEqual([]);
    });
  });

  test('alerts keep the fixed order', () => {
    const all = cycle({
      nfe: { id: 3, status: 'error', lastError: 'x' },
      delivery: { kind: 'courier', id: 8, status: 'failed', failedAt: null }
    });
    expect(codes(alertsOf(all, { row: { editPending: { a: 1 } } }))).toEqual(['nfe_problem', 'delivery_failed', 'pending_change']);
  });
});
