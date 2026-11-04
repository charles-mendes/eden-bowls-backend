const { SubscriptionsDetailRepository } = require('../src/infrastructure/repositories/subscriptions-detail.repository');

describe('SubscriptionsDetailRepository plan_notice', () => {
  test('Explicit cancellation inside the window, with no Stripe call for the notice', async () => {
    const periodEnd = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const repository = new SubscriptionsDetailRepository({
      ledgerRepository: {
        findByUserIdAndSubscriptionId: async () => ({
          stripeSubscriptionId: 'sub_1',
          stripeAccount: 'us',
          status: 'active',
          autoRenew: true,
          cancelAtPeriodEnd: true,
          currentPeriodEnd: periodEnd,
          petsSnapshot: [],
          planSelection: {},
          address: {}
        })
      },
      settingsRepository: { forMarket: async () => ({ planNoticeDays: 7 }) }
    });

    const { subscription } = await repository.getDetail(7, 'sub_1');

    expect(subscription.plan_notice).toEqual({ kind: 'ending', date: periodEnd.toISOString(), days_left: 2 });
  });
});

describe('SubscriptionsDetailRepository billing history', () => {
  function build(invoices, shipments) {
    return new SubscriptionsDetailRepository({
      ...(shipments ? { upsShipmentRepository: { listByInvoiceIds: async () => shipments } } : {}),
      ledgerRepository: {
        findByUserIdAndSubscriptionId: async () => ({
          stripeSubscriptionId: 'sub_1',
          petsSnapshot: [],
          planSelection: {},
          address: {}
        })
      },
      stripeBilling: {
        listInvoicesForSubscription: async () => invoices
      }
    });
  }

  test('leaves out the R$ 0 invoice Stripe creates when the next charge date moves', async () => {
    const repository = build([
      { id: 'in_move', billing_reason: 'subscription_update', status: 'paid', total: 0, amount_paid: 0, created: 1792724541, currency: 'brl' },
      { id: 'in_create', billing_reason: 'subscription_create', status: 'paid', total: 45247, amount_paid: 45247, created: 1791949280, currency: 'brl' }
    ]);

    const { subscription } = await repository.getDetail(7, 'sub_1');

    expect(subscription.billing_history.map((item) => item.invoice_id)).toEqual(['in_create']);
  });

  test('keeps a charged plan change invoice', async () => {
    const repository = build([
      { id: 'in_change', billing_reason: 'subscription_update', status: 'paid', total: 1200, amount_paid: 1200, created: 1792724541, currency: 'brl' }
    ]);

    const { subscription } = await repository.getDetail(7, 'sub_1');

    expect(subscription.billing_history.map((item) => item.invoice_id)).toEqual(['in_change']);
  });

  test('returns the stage dates and the delivery timeline of each shipment', async () => {
    const repository = build(
      [{ id: 'in_1', billing_reason: 'subscription_cycle', status: 'paid', total: 1200, amount_paid: 1200, created: 1792724541, currency: 'usd' }],
      [{
        stripe_invoice_id: 'in_1', status: 'created', tracking_number: '1Z1', tracking_status: 'in_transit', tracking_description: 'Departed',
        shipped_at: '2026-11-01 10:00:00', in_transit_at: '2026-11-02 08:00:00', out_for_delivery_at: null, delivered_at: null
      }]
    );

    const { subscription } = await repository.getDetail(7, 'sub_1');
    const [charge] = subscription.billing_history;

    expect(charge).toMatchObject({
      tracking_description: 'Departed',
      label_created_at: '2026-11-01 10:00:00',
      in_transit_at: '2026-11-02 08:00:00',
      out_for_delivery_at: null,
      delivery_timeline: { current: 'in_transit', warning: null, description: 'Departed' }
    });
    expect(charge.delivery_timeline.stages.map((stage) => stage.reached)).toEqual([true, true, false, false]);
  });

  test('a charge without a shipment has no timeline', async () => {
    const repository = build([{ id: 'in_1', status: 'paid', total: 1200, amount_paid: 1200, created: 1792724541, currency: 'usd' }], []);

    const { subscription } = await repository.getDetail(7, 'sub_1');

    expect(subscription.billing_history[0].delivery_timeline).toBeNull();
  });
});

describe('SubscriptionsDetailRepository courier deliveries (Brazil)', () => {
  const paid = { id: 'in_br', billing_reason: 'subscription_cycle', status: 'paid', subtotal: 25900, total: 25900, amount_paid: 25900, created: 1793800000, status_transitions: { paid_at: 1793800100 }, currency: 'brl' };
  function build(invoices, courierRows, address = { country: 'BR' }) {
    const listByInvoiceIds = jest.fn(async () => courierRows);
    const repository = new SubscriptionsDetailRepository({
      courierDeliveryRepository: { listByInvoiceIds },
      upsShipmentRepository: { listByInvoiceIds: async () => [] },
      ledgerRepository: {
        findByUserIdAndSubscriptionId: async () => ({ stripeSubscriptionId: 'sub_br', stripeAccount: 'br', petsSnapshot: [], planSelection: {}, address })
      },
      stripeBilling: { listInvoicesForSubscription: async () => invoices }
    });
    return { repository, listByInvoiceIds };
  }
  const courierRow = (extra) => ({
    id: 1, stripe_invoice_id: 'in_br', method: 'uber', cost_minor: 1850, note: 'Portão azul', failure_reason: null, created_by: 99,
    tracking_url: null, out_for_delivery_at: new Date('2026-11-04T12:00:00Z'), ...extra
  });

  test('On the road with a link: timeline, link and no tracking number, nothing internal', async () => {
    const { repository } = build([paid], [courierRow({ status: 'out_for_delivery', tracking_url: 'https://trip.uber.com/abc123' })]);
    const [charge] = (await repository.getDetail(7, 'sub_br')).subscription.billing_history;

    expect(charge).toMatchObject({
      tracking_number: null,
      tracking_url: 'https://trip.uber.com/abc123',
      out_for_delivery_at: '2026-11-04T12:00:00.000Z',
      delivered_at: null,
      delivery_timeline: { carrier: 'courier', current: 'out_for_delivery', warning: null }
    });
    expect(charge.delivery_timeline.stages[0]).toEqual({ key: 'preparing', reached: true, at: new Date(1793800100 * 1000).toISOString() });
    const json = JSON.stringify(charge);
    for (const hidden of ['uber"', '1850', 'Portão', 'method', 'cost', 'note', 'created_by', 'failure_reason']) {
      expect(json).not.toContain(hidden);
    }
  });

  test('Failed: preparing is current with the failed warning, the reason stays out', async () => {
    const { repository } = build([paid], [courierRow({ status: 'failed', failure_reason: 'Ninguém em casa', tracking_url: 'https://trip.uber.com/old' })]);
    const [charge] = (await repository.getDetail(7, 'sub_br')).subscription.billing_history;

    expect(charge.delivery_timeline).toMatchObject({ current: 'preparing', warning: { status: 'failed' } });
    expect(charge.tracking_url).toBeNull();
    expect(JSON.stringify(charge)).not.toContain('Ninguém');
  });

  test('Paid with no delivery: only preparing is reached', async () => {
    const { repository } = build([paid], []);
    const [charge] = (await repository.getDetail(7, 'sub_br')).subscription.billing_history;

    expect(charge.delivery_timeline.stages.map((stage) => stage.reached)).toEqual([true, false, false]);
  });

  test('a skipped R$ 0 cycle and an open invoice have no timeline', async () => {
    const { repository } = build([{ ...paid, id: 'in_skip', subtotal: 0, total: 0, amount_paid: 0 }, { ...paid, id: 'in_open', status: 'open' }], []);
    const history = (await repository.getDetail(7, 'sub_br')).subscription.billing_history;

    expect(history.map((charge) => charge.delivery_timeline)).toEqual([null, null]);
  });

  test('a US address keeps the UPS history and reads no courier row', async () => {
    const { repository, listByInvoiceIds } = build([{ ...paid, currency: 'usd' }], [], { country: 'US' });
    const [charge] = (await repository.getDetail(7, 'sub_br')).subscription.billing_history;

    expect(listByInvoiceIds).not.toHaveBeenCalled();
    expect(charge.delivery_timeline).toBeNull();
  });
});
