const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR } = require('../src/core/delivery-closed-days');
const { CustomerDeliveriesService, buildDeliveryRead } = require('../src/services/customer-deliveries.service');
const { PendingDeliveryChangesService } = require('../src/services/pending-delivery-changes.service');
const { SubscriptionsEditCommitService } = require('../src/services/subscriptions-edit-commit.service');
const { AdminProductionService } = require('../src/services/admin-production.service');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');
const { mapDeliverySubscription } = require('../src/infrastructure/repositories/subscription-deliveries.repository');

const rows = buildSeedRows();

function at(year, month, day, hour = 0) {
  return wallTimeToUtc(year, month, day, hour, 0, 0, TIMEZONE_BR);
}

function unix(year, month, day) {
  return Math.floor(at(year, month, day).getTime() / 1000);
}

// Brazil, 3 month term, one delivery charged. The current charge is Saturday 3 January 2026 at 14:00, so the
// current delivery is Monday 5 January; the following charge is Tuesday 3 February at 14:00, delivered Wednesday 4.
function plan(overrides = {}) {
  return {
    id: 'sub_123',
    stripeSubscriptionId: 'sub_123',
    status: 'active',
    userId: 7,
    market: 'BR',
    termMonths: 3,
    chargedCount: 1,
    autoRenew: true,
    chargeAt: at(2026, 1, 3, 14),
    productionStatus: 'in_production',
    packsPerMonth: 8,
    subtotal: 100,
    transitDays: 0,
    ...overrides
  };
}

const BEFORE_CHARGE = at(2026, 1, 1, 12);

function service({ subscription = plan(), now = BEFORE_CHARGE } = {}) {
  let stored = { ...subscription };
  const stripe = { setTrialEnd: jest.fn(async (update) => ({ id: update.subscriptionId })) };
  const subscriptions = {
    findForUser: jest.fn(async (_id, userId) => (String(userId) === String(stored.userId) ? { ...stored } : null)),
    recordPendingChanges: jest.fn(async (_subscription, changes) => {
      stored = { ...stored, pendingDeliveryChanges: changes };
    }),
    recordChargeMoved: jest.fn()
  };
  const deliveries = new CustomerDeliveriesService({
    calendar: { listActive: async () => rows },
    subscriptions,
    stripeAccounts: { get: () => stripe },
    now: () => now
  });
  return { deliveries, stripe, subscriptions, current: () => stored };
}

describe('following delivery read (3.9)', () => {
  test('a locked current delivery moves skip, dates, and end dates to the following delivery', () => {
    const read = buildDeliveryRead({ ...plan(), rows, now: BEFORE_CHARGE });

    expect(read.delivery).toMatchObject({ date: '2026-01-05', locked: true, actions: false });
    expect(read.actionTarget).toMatchObject({ id: 'following', date: '2026-02-04' });
    // Skipping the following delivery: the current one still ships, the last contracted one moves to March.
    expect(read.contractEnd).toBe('2026-02-04');
    expect(read.contractEndIfSkip).toBe('2026-03-04');
    expect(read.nextDeliveryIfSkip).toBe('2026-03-04');
    const dates = read.offeredDates.map((offer) => offer.deliveryDate);
    expect(dates[0]).toBe('2026-02-05');
    expect(dates[dates.length - 1]).toBe('2026-03-04');
    expect(dates).not.toContain('2026-02-04');
    expect(dates).not.toContain('2026-02-16');
    expect(dates).not.toContain('2026-02-17');
    expect(dates).not.toContain('2026-02-08');
    expect(read.offeredDates.find((offer) => offer.deliveryDate === '2026-02-20').contractEnd).toBe('2026-02-20');
  });

  test('an editable current delivery keeps the actions and its own dates', () => {
    const read = buildDeliveryRead({ ...plan({ productionStatus: 'to_prepare' }), rows, now: BEFORE_CHARGE });
    expect(read.actionTarget.id).toBe('current');
    expect(read.offeredDates[0].deliveryDate).toBe('2026-01-06');
    expect(read.offeredDates[read.offeredDates.length - 1].deliveryDate).toBe('2026-02-04');
  });

  test('a pending skip projects the later deliveries from the moved charge', () => {
    const read = buildDeliveryRead({
      ...plan(),
      pendingDeliveryChanges: { charge_move: { kind: 'skip', trial_end: unix(2026, 3, 4) } },
      rows,
      now: BEFORE_CHARGE
    });
    expect(read.later.map((item) => item.deliveryDate)).toEqual(['2026-03-04']);
    expect(read.contractEnd).toBe('2026-03-04');
    expect(read.pendingChange).toEqual({ kind: 'skip' });
  });

  test('a pending charge recorded against another charge is stale and ignored', () => {
    const subscription = mapDeliverySubscription({
      stripeSubscriptionId: 'sub_123',
      currentPeriodEnd: at(2026, 2, 3, 14),
      pendingDeliveryChanges: { after_charge_at: at(2026, 1, 3, 14).toISOString(), charge_move: { trial_end: 1 } }
    });
    expect(subscription.pendingDeliveryChanges).toBeNull();
  });
});

describe('following delivery routes (3.9)', () => {
  test('skip of the following delivery waits for the current charge and does not touch Stripe', async () => {
    const { deliveries, stripe, subscriptions } = service();
    const read = await deliveries.skip(plan(), 7, { deliveryId: 'following' });

    expect(stripe.setTrialEnd).not.toHaveBeenCalled();
    expect(subscriptions.recordPendingChanges).toHaveBeenCalledWith(expect.anything(), {
      charge_move: { kind: 'skip', trial_end: unix(2026, 3, 4) },
      after_charge_at: at(2026, 1, 3, 14).toISOString(),
      recorded_at: BEFORE_CHARGE.toISOString()
    });
    expect(read.delivery.date).toBe('2026-01-05');
    expect(read.later.map((item) => item.deliveryDate)).toEqual(['2026-03-04']);
    expect(read.stripeChanged).toBe(false);
  });

  test('reschedule of the following delivery stores midnight of the chosen preparation day', async () => {
    const { deliveries, stripe, subscriptions } = service();
    await deliveries.reschedule(plan(), 7, { deliveryId: 'following', date: '2026-02-20' });
    expect(stripe.setTrialEnd).not.toHaveBeenCalled();
    expect(subscriptions.recordPendingChanges.mock.calls[0][1].charge_move)
      .toEqual({ kind: 'reschedule', trial_end: unix(2026, 2, 20) });

    await expect(deliveries.reschedule(plan(), 7, { deliveryId: 'following', date: '2026-02-16' }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'date_not_allowed' } });
    await expect(deliveries.reschedule(plan(), 7, { deliveryId: 'following', date: '2026-03-05' }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'date_not_allowed' } });
  });

  test('a delivery that is not the action target stays locked', async () => {
    const { deliveries, subscriptions } = service();
    await expect(deliveries.skip(plan(), 7, { deliveryId: 'current' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'delivery_locked' } });
    await expect(deliveries.skip(plan(), 7, { deliveryId: 'later-1' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'delivery_locked' } });
    // Once the following delivery's own deadline is past there is no target at all.
    const late = service({ now: at(2026, 2, 3, 1) });
    await expect(late.deliveries.skip(plan({ chargeAt: at(2026, 1, 3, 14) }), 7, { deliveryId: 'following' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'delivery_locked' } });
    expect(subscriptions.recordPendingChanges).not.toHaveBeenCalled();
  });

  test('another customer cannot change the following delivery', async () => {
    const { deliveries, subscriptions } = service();
    await expect(deliveries.skip(plan(), 8, { deliveryId: 'following' }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(subscriptions.recordPendingChanges).not.toHaveBeenCalled();
  });

  test('when the current delivery is already paid the following charge moves in Stripe at once', async () => {
    const { deliveries, stripe, subscriptions } = service({ subscription: plan({ currentPaid: true }) });
    await deliveries.skip(plan({ currentPaid: true }), 7, { deliveryId: 'following' });
    expect(subscriptions.recordPendingChanges).not.toHaveBeenCalled();
    expect(stripe.setTrialEnd).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      trial_end: unix(2026, 3, 4),
      proration_behavior: 'none'
    });
  });
});

describe('pending changes after the current charge (3.9)', () => {
  const recordedAgainst = at(2026, 1, 3, 14);
  const pending = {
    after_charge_at: recordedAgainst.toISOString(),
    charge_move: { kind: 'skip', trial_end: unix(2026, 3, 4) },
    packs: { payload: { delivery_id: 'following', expected_current_hash: 'h' }, packs_per_month: 6, subtotal: 75 }
  };

  function applier({ now = at(2026, 1, 3, 16), commit = jest.fn().mockResolvedValue({}) } = {}) {
    let stored = pending;
    const ledger = {
      findByStripeSubscriptionId: jest.fn(async () => ({ userId: 7, pendingDeliveryChanges: stored })),
      takePendingDeliveryChanges: jest.fn(async () => {
        const taken = stored;
        stored = null;
        return taken;
      }),
      setPendingDeliveryChanges: jest.fn(async (_id, value) => { stored = value; })
    };
    const logger = { info() {}, warn: jest.fn(), error() {} };
    const changes = new PendingDeliveryChangesService({ ledgerRepository: ledger, editCommitRepository: { commit }, logger, now: () => now });
    return { changes, ledger, commit, logger, stored: () => stored };
  }

  const paidPeriod = { current_period_start: Math.floor(recordedAgainst.getTime() / 1000) };

  test('the current invoice.paid applies the packs, then moves the following charge, once', async () => {
    const { changes, commit } = applier();
    const billing = { setTrialEnd: jest.fn().mockResolvedValue({}) };
    const order = [];
    commit.mockImplementation(async () => { order.push('packs'); });
    billing.setTrialEnd.mockImplementation(async () => { order.push('charge'); });

    await changes.applyAfterCharge({ subscriptionId: 'sub_123', subscription: paidPeriod, billing });
    expect(commit).toHaveBeenCalledWith(7, 'sub_123', pending.packs.payload);
    expect(billing.setTrialEnd).toHaveBeenCalledWith({ subscriptionId: 'sub_123', trial_end: unix(2026, 3, 4), proration_behavior: 'none' });
    expect(order).toEqual(['packs', 'charge']);

    await changes.applyAfterCharge({ subscriptionId: 'sub_123', subscription: paidPeriod, billing });
    expect(billing.setTrialEnd).toHaveBeenCalledTimes(1);
  });

  test('an older invoice replayed before the current charge does not release the change', async () => {
    const { changes, stored } = applier();
    const billing = { setTrialEnd: jest.fn() };
    await changes.applyAfterCharge({
      subscriptionId: 'sub_123',
      subscription: { current_period_start: Math.floor(at(2025, 12, 3, 14).getTime() / 1000) },
      billing
    });
    expect(billing.setTrialEnd).not.toHaveBeenCalled();
    expect(stored()).toBe(pending);
  });

  test('a failed charge move keeps it pending for the retry, without repeating the packs', async () => {
    const { changes, stored } = applier();
    const billing = { setTrialEnd: jest.fn().mockRejectedValue(new Error('stripe down')) };
    await expect(changes.applyAfterCharge({ subscriptionId: 'sub_123', subscription: paidPeriod, billing }))
      .rejects.toThrow('stripe down');
    expect(stored()).toEqual({ after_charge_at: pending.after_charge_at, charge_move: pending.charge_move });
  });

  test('a charge date already past is dropped with a warning and nothing is set in the past', async () => {
    const { changes, logger } = applier({ now: at(2026, 3, 5) });
    const billing = { setTrialEnd: jest.fn() };
    await changes.applyAfterCharge({ subscriptionId: 'sub_123', subscription: paidPeriod, billing });
    expect(billing.setTrialEnd).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('the webhook runs the pending change after counting a charged cycle invoice', async () => {
    const applyAfterCharge = jest.fn().mockResolvedValue(null);
    const ledgerRow = { stripeSubscriptionId: 'sub_123', chargedDeliveries: 1, autoRenew: true };
    const webhook = new StripeWebhookService({
      ledgerRepository: {
        findByStripeSubscriptionId: jest.fn().mockResolvedValue(ledgerRow),
        incrementChargedDeliveries: jest.fn().mockResolvedValue({ ...ledgerRow, chargedDeliveries: 2 })
      },
      pendingDeliveryChanges: { applyAfterCharge }
    });
    await webhook.recordChargedDelivery({
      invoice: { id: 'in_1', billing_reason: 'subscription_cycle', subtotal: 10000 },
      subscriptionId: 'sub_123',
      subscription: paidPeriod,
      billing: {}
    });
    expect(applyAfterCharge).toHaveBeenCalledWith({ subscriptionId: 'sub_123', subscription: paidPeriod, billing: {} });

    applyAfterCharge.mockClear();
    await webhook.recordChargedDelivery({
      invoice: { id: 'in_0', billing_reason: 'subscription_update', subtotal: 0 },
      subscriptionId: 'sub_123',
      subscription: paidPeriod,
      billing: {}
    });
    expect(applyAfterCharge).not.toHaveBeenCalled();
  });
});

describe('following delivery packs and operator block (3.9)', () => {
  test('a pack save for the following delivery is validated now and stored for after the current charge', async () => {
    const repository = { commit: jest.fn().mockResolvedValue({ packs_per_month: 6, subtotal: 75, proration: { direction: 'none' } }) };
    const deliveryGuard = {
      loadSubscription: jest.fn().mockResolvedValue({ id: 'sub_123' }),
      commitPacks: jest.fn().mockResolvedValue({ deferred: true }),
      recordPendingPacks: jest.fn().mockResolvedValue({})
    };
    const commitService = new SubscriptionsEditCommitService(repository, {
      authService: { assertCriticalOperationAllowed: jest.fn() },
      ledgerRepository: {
        findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue({ status: 'active' }),
        listByUserId: jest.fn().mockResolvedValue([])
      },
      deliveryGuard
    });
    const payload = {
      subscription_term_months: 3,
      delivery_id: 'following',
      expected_current_hash: 'h',
      pets: [{ pet_id: 'pet_1', pet_name: 'Milo', enabled: true, selected_flavors: ['beef'], flavor_weights: [6] }]
    };
    const result = await commitService.commit({ subscriptionId: 'sub_123', userId: 7, payload });

    expect(repository.commit).toHaveBeenCalledWith(7, 'sub_123', expect.objectContaining({ delivery_id: 'following' }), expect.anything(), { defer: true });
    expect(deliveryGuard.recordPendingPacks).toHaveBeenCalledWith({ id: 'sub_123' }, 7, {
      payload: expect.objectContaining({ delivery_id: 'following' }),
      packs_per_month: 6,
      subtotal: 75
    });
    expect(result.data.pending_until_current_charge).toBe(true);
  });

  test('an operator block drops a pending charge move and keeps pending packs', async () => {
    const setPendingDeliveryChanges = jest.fn();
    const periodEnd = at(2026, 1, 3, 14);
    const row = {
      id: 1,
      stripeSubscriptionId: 'sub_123',
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: periodEnd,
      pendingDeliveryChanges: { after_charge_at: periodEnd.toISOString(), charge_move: { trial_end: 1 }, packs: { payload: {} } }
    };
    const admin = new AdminProductionService({
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(row),
        findQueueRowById: jest.fn().mockResolvedValue(row),
        setPendingDeliveryChanges
      },
      productionRepository: { findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      now: () => BEFORE_CHARGE
    });
    await admin.updateStatus(1, { status: 'blocked', note: 'kitchen', periodEnd });
    expect(setPendingDeliveryChanges).toHaveBeenCalledWith('sub_123', { after_charge_at: periodEnd.toISOString(), packs: { payload: {} } });
  });
});

describe('following delivery over HTTP (3.9)', () => {
  const request = require('supertest');
  const { createApp } = require('../src/app');
  const { issueJwtToken } = require('../src/core/jwt-token');
  const jwt = { secret: 'secret', algorithm: 'HS256', issuer: 'http://localhost:3000' };
  const token = (userId) => issueJwtToken({ data: { user: { id: userId } } }, { ...jwt, ttlSeconds: 900, now: Math.floor(Date.now() / 1000) });

  test('the routes accept the following delivery when it is the action target and refuse the current one', async () => {
    const { deliveries, subscriptions } = service();
    const app = createApp({ customerDeliveriesService: deliveries, corsOrigins: ['http://localhost:5173'], jwt });
    const headers = { Authorization: `Bearer ${token(7)}` };

    const read = await request(app).get('/api/v1/subscriptions/sub_123/deliveries').set(headers);
    expect(read.body.actionTarget.id).toBe('following');
    expect(read.body.targetChargeAt).toBeUndefined();

    const locked = await request(app).post('/api/v1/subscriptions/sub_123/deliveries/current/skip').set(headers).send({});
    expect(locked.status).toBe(409);
    expect(locked.body.details.code).toBe('delivery_locked');

    const moved = await request(app)
      .post('/api/v1/subscriptions/sub_123/deliveries/following/reschedule')
      .set(headers)
      .send({ date: '2026-02-20' });
    expect(moved.status).toBe(200);
    expect(moved.body.pendingChange).toEqual({ kind: 'reschedule' });
    expect(subscriptions.recordPendingChanges).toHaveBeenCalledTimes(1);

    const other = await request(app)
      .post('/api/v1/subscriptions/sub_123/deliveries/following/skip')
      .set({ Authorization: `Bearer ${token(8)}` })
      .send({});
    expect(other.status).toBe(404);
  });
});
