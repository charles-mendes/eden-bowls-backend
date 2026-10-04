const { HttpError } = require('../src/core/http-error');
const { buildSeedRows, wallTimeToUtc, TIMEZONE_BR, TIMEZONE_US } = require('../src/core/delivery-closed-days');
const {
  CustomerDeliveriesService,
  buildDeliveryRead,
  keepLaterPreparation,
  offerDates,
  planBlockTrialEnd
} = require('../src/services/customer-deliveries.service');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');

const rows = buildSeedRows();
const quoteSigner = new ShippingQuoteSigner({ secret: 'test-shipping-quote-secret' });

function addressQuote(market, { distance = null, deliveryDays = null, cost = 10 } = {}) {
  const zipcode = market === 'BR' ? '01310100' : '94105';
  return {
    zipcode,
    shipping: {
      cost,
      distance,
      delivery_days: deliveryDays,
      quote_token: quoteSigner.sign({ country: market, zipcode, cost, distance, deliveryDays })
    }
  };
}

function charge(year, month, day, hour, zone) {
  return wallTimeToUtc(year, month, day, hour, 0, 0, zone);
}

function subscription(overrides = {}) {
  return {
    id: 'sub_123',
    stripeSubscriptionId: 'sub_123',
    status: 'active',
    userId: 7,
    market: 'BR',
    termMonths: 3,
    chargedCount: 1,
    autoRenew: true,
    chargeAt: charge(2026, 1, 3, 14, TIMEZONE_BR),
    productionDate: '2026-01-05',
    nextShipmentDate: '2025-01-01',
    productionStatus: 'to_prepare',
    packsPerMonth: 8,
    subtotal: 100,
    transitDays: 0,
    ...overrides
  };
}

describe('customer delivery read', () => {
  test('ignores a stale checkout shipment date and does not move the charge', () => {
    const read = buildDeliveryRead({
      ...subscription(),
      rows,
      now: charge(2026, 1, 1, 12, TIMEZONE_BR)
    });
    expect(read.delivery.date).toBe('2026-01-05');
    expect(read.ignoredShipmentDate).toBe('2025-01-01');
    expect(read.stripeChanged).toBe(false);
    expect(read.delivery.editableUntil).toBe(
      wallTimeToUtc(2026, 1, 2, 23, 59, 59, TIMEZONE_BR).toISOString()
    );
    expect(read.later).toHaveLength(1);
    expect(read.contractEnd).toBe(read.later[0].deliveryDate);
    expect(read.contractEndIfSkip).not.toBe(read.contractEnd);
    expect(read.delivery.actions).toBe(true);
  });

  test('hides edits after the charge and omits a missing price', () => {
    const read = buildDeliveryRead({
      ...subscription({ subtotal: null }),
      rows,
      now: charge(2026, 1, 3, 15, TIMEZONE_BR)
    });
    expect(read.delivery.actions).toBe(false);
    expect(read.delivery.locked).toBe(true);
    expect(read.delivery.price).toBeUndefined();
    expect(read.delivery.date).toBe('2026-01-05');
  });

  test('a midnight trial end prepares on that day', () => {
    const trialEnd = wallTimeToUtc(2026, 1, 5, 0, 0, 0, TIMEZONE_BR);
    const read = buildDeliveryRead({
      ...subscription({ chargeAt: trialEnd, productionDate: null, nextShipmentDate: null }),
      rows,
      now: charge(2026, 1, 1, 12, TIMEZONE_BR)
    });
    expect(read.delivery.preparationDay).toBe('2026-01-05');
    expect(read.delivery.date).toBe('2026-01-05');
  });

  test('locks each production status on its own and keeps to_prepare editable', () => {
    const now = charge(2026, 1, 1, 12, TIMEZONE_BR);
    for (const status of ['in_production', 'ready', 'blocked']) {
      const read = buildDeliveryRead({ ...subscription({ productionStatus: status }), rows, now });
      expect(read.delivery.locked).toBe(true);
      expect(read.delivery.actions).toBe(false);
    }
    expect(buildDeliveryRead({
      ...subscription({ productionStatus: 'in_production' }),
      rows,
      now
    }).delivery.statusLabel).toBe('Em preparo');
    expect(buildDeliveryRead({
      ...subscription({ productionStatus: 'ready' }),
      rows,
      now
    }).delivery.statusLabel).toBe('Pronto para envio');
    const open = buildDeliveryRead({ ...subscription({ productionStatus: 'to_prepare' }), rows, now });
    expect(open.delivery.actions).toBe(true);
  });

  test('a missing timezone omits the deadline and the three actions', () => {
    const read = buildDeliveryRead({
      ...subscription({ market: null, productionDate: '2026-01-05' }),
      rows,
      now: new Date()
    });
    expect(read.delivery.date).toBe('2026-01-05');
    expect(read.delivery.price).toBe(100);
    expect(read.delivery.editableUntil).toBeUndefined();
    expect(read.delivery.actions).toBe(false);
  });

  test('refuses an address change when the quote is missing', async () => {
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => [] },
      shippingQuoteSigner: quoteSigner
    });
    await expect(service.applyAddressChange(subscription(), {})).rejects.toMatchObject({
      details: { code: 'delivery_area_unverified' }
    });
    await expect(service.applyAddressChange(subscription({ market: 'US', transitDays: 1 }), addressQuote('US'))).rejects.toMatchObject({
      details: { code: 'delivery_area_unverified' }
    });
    await expect(service.applyAddressChange(subscription(), addressQuote('BR', { distance: 40 }))).resolves.toEqual(expect.objectContaining({
      stripeChanged: false
    }));
  });

  test('an in-limit address change keeps the charge', async () => {
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      shippingQuoteSigner: quoteSigner
    });
    const current = subscription();
    const changed = await service.applyAddressChange(current, addressQuote('BR', { distance: 10 }));
    expect(changed.chargeAt).toBe(current.chargeAt);
    expect(changed.editableUntil).toBe(wallTimeToUtc(2026, 1, 2, 23, 59, 59, TIMEZONE_BR).toISOString());
    expect(changed.stripeChanged).toBe(false);
    await expect(service.applyAddressChange(current, addressQuote('BR', { distance: 41 }))).rejects.toBeInstanceOf(HttpError);
  });

  test('does not call UPS when transit is already stored', async () => {
    const quoteTransitDays = jest.fn();
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      ups: { quoteTransitDays },
      now: () => charge(2026, 1, 1, 12, TIMEZONE_US)
    });
    const item = subscription({
      market: 'US',
      transitDays: 1,
      productionDate: '2026-01-07',
      chargeAt: charge(2026, 1, 2, 10, TIMEZONE_US)
    });
    await service.read(item, 7);
    await service.read(item, 7);
    expect(quoteTransitDays).not.toHaveBeenCalled();
  });

  test('rejects an edit after the Saturday charge', async () => {
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      now: () => charge(2026, 1, 3, 15, TIMEZONE_BR)
    });
    await expect(service.skip(subscription(), 7)).rejects.toMatchObject({ statusCode: 409, details: { code: 'delivery_locked' } });
  });
  test('two reads store transit once', async () => {
    const quoteTransitDays = jest.fn().mockResolvedValue(1);
    const storeTransitDays = jest.fn(async (item, days) => {
      item.transitDays = days;
    });
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      ups: { quoteTransitDays, storeTransitDays },
      now: () => charge(2026, 1, 1, 12, TIMEZONE_US)
    });
    const item = subscription({
      market: 'US',
      transitDays: null,
      productionDate: '2026-01-07',
      chargeAt: charge(2026, 1, 2, 10, TIMEZONE_US)
    });
    const first = await service.read(item, 7);
    const second = await service.read(item, 7);
    expect(first.upsCalls).toBe(1);
    expect(second.upsCalls).toBe(0);
    expect(quoteTransitDays).toHaveBeenCalledTimes(1);
  });
});

describe('production block trial end', () => {
  test('a block before preparation does not create an invoice', async () => {
    const setTrialEnd = jest.fn().mockResolvedValue({});
    const createInvoice = jest.fn();
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      stripeAccounts: { get: () => ({ setTrialEnd, invoices: { create: createInvoice } }) },
      now: () => charge(2026, 5, 4, 0, TIMEZONE_US)
    });
    const plan = await service.onProductionStatus({
      subscription: {
        market: 'US',
        chargeAt: wallTimeToUtc(2026, 5, 4, 0, 0, 0, TIMEZONE_US),
        transitDays: 1,
        stripeSubscriptionId: 'sub_us'
      },
      toStatus: 'blocked',
      fromStatus: 'to_prepare',
      alreadyCharged: false
    });
    expect(plan.invoice).toBe(false);
    expect(createInvoice).not.toHaveBeenCalled();
    expect(setTrialEnd).toHaveBeenCalledWith(expect.objectContaining({
      proration_behavior: 'none'
    }));
    expect(typeof setTrialEnd.mock.calls[0][0].trial_end).toBe('number');
  });
  test('a Thursday preparation moves to the next valid weekday and does not invoice', () => {
    const plan = planBlockTrialEnd({
      market: 'US',
      rows,
      transitDays: 1,
      followingChargeAt: wallTimeToUtc(2026, 6, 4, 0, 0, 0, TIMEZONE_US),
      now: charge(2026, 6, 1, 12, TIMEZONE_US),
      alreadyCharged: false,
      returning: false
    });
    expect(plan.invoice).toBe(false);
    expect(plan.refund).toBe(false);
    expect(plan.stripeUpdate.proration_behavior).toBe('none');
    expect(plan.preparationDay).not.toBe('2026-06-04');
    const weekday = new Date(`${plan.preparationDay}T00:00:00Z`).getUTCDay();
    expect([1, 2, 3]).toContain(weekday);
  });

  test('a late unblock charges now without a past trial end and a paid charge is not refunded', () => {
    const late = planBlockTrialEnd({
      market: 'BR',
      rows,
      transitDays: 0,
      followingChargeAt: charge(2026, 1, 5, 0, TIMEZONE_BR),
      originalPreparationDay: '2026-01-05',
      now: charge(2026, 1, 6, 12, TIMEZONE_BR),
      alreadyCharged: false,
      returning: true
    });
    expect(late.stripeUpdate).toEqual({ trial_end: 'now', proration_behavior: 'none' });
    expect(late.invoice).toBe(false);
    const paid = planBlockTrialEnd({
      market: 'BR',
      rows,
      transitDays: 0,
      followingChargeAt: charge(2026, 1, 5, 0, TIMEZONE_BR),
      now: charge(2026, 1, 6, 12, TIMEZONE_BR),
      alreadyCharged: true,
      returning: true
    });
    expect(paid.stripeUpdate).toBeNull();
    expect(paid.refund).toBe(false);
  });

  test('an early return restores the original preparation midnight', async () => {
    const setTrialEnd = jest.fn().async ? jest.fn() : jest.fn();
    setTrialEnd.mockResolvedValue({});
    const service = new CustomerDeliveriesService({
      calendar: { listActive: async () => rows },
      stripeAccounts: { get: () => ({ setTrialEnd }) },
      now: () => charge(2026, 1, 1, 12, TIMEZONE_BR)
    });
    const plan = await service.onProductionStatus({
      subscription: {
        market: 'BR',
        chargeAt: charge(2026, 1, 3, 14, TIMEZONE_BR),
        transitDays: 0,
        stripeSubscriptionId: 'sub_123',
        originalPreparationDay: '2026-01-05'
      },
      toStatus: 'to_prepare',
      fromStatus: 'blocked',
      alreadyCharged: false
    });
    expect(plan.invoice).toBe(false);
    expect(setTrialEnd).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      proration_behavior: 'none',
      trial_end: Math.floor(wallTimeToUtc(2026, 1, 5, 0, 0, 0, TIMEZONE_BR).getTime() / 1000)
    }));
  });
});

function unix(year, month, day, zone) {
  return Math.floor(wallTimeToUtc(year, month, day, 0, 0, 0, zone).getTime() / 1000);
}

// A Brazil plan charged Saturday 7 February 2026 at 14:00: preparation and delivery Monday 9 February.
function saturdayPlan(overrides = {}) {
  return subscription({
    chargeAt: charge(2026, 2, 7, 14, TIMEZONE_BR),
    productionDate: null,
    nextShipmentDate: null,
    ...overrides
  });
}

// Stripe answers trialing with the new trial end; the ledger stub then reports the moved charge.
function movingCharge(initial) {
  let current = { ...initial };
  const stripe = {
    setTrialEnd: jest.fn(async ({ trial_end }) => ({ id: 'sub_123', status: 'trialing', trial_end })),
    pauseSubscription: jest.fn()
  };
  const subscriptions = {
    findForUser: jest.fn(async () => current),
    recordChargeMoved: jest.fn(async (_item, updated) => {
      current = { ...current, status: updated.status, chargeAt: new Date(updated.trial_end * 1000) };
    })
  };
  return { stripe, subscriptions };
}

function movingService(initial, now) {
  const { stripe, subscriptions } = movingCharge(initial);
  const service = new CustomerDeliveriesService({
    calendar: { listActive: async () => rows },
    subscriptions,
    stripeAccounts: { get: () => stripe },
    now: () => now
  });
  return { service, stripe, subscriptions };
}

describe('market delivery days', () => {
  const { brazilPrepValid, usPrepValid } = require('../src/core/delivery-closed-days');

  test('a Brazil Monday is a delivery day, a Sunday and Carnival 2026 are not', () => {
    expect(brazilPrepValid({ year: 2026, month: 1, day: 5 }, rows)).toBe(true);
    expect(brazilPrepValid({ year: 2026, month: 1, day: 4 }, rows)).toBe(false);
    expect(brazilPrepValid({ year: 2026, month: 2, day: 16 }, rows)).toBe(false);
    expect(brazilPrepValid({ year: 2026, month: 2, day: 17 }, rows)).toBe(false);
  });

  test('a United States preparation day needs a pickup and a delivery day', () => {
    expect(usPrepValid({ year: 2026, month: 11, day: 20 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 12, day: 23 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 12, day: 30 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 12, day: 29 }, rows, 1)).toBe(false);
    expect(usPrepValid({ year: 2026, month: 12, day: 22 }, rows, 1)).toBe(true);
    expect(usPrepValid({ year: 2026, month: 11, day: 26 }, rows, 1)).toBe(false);
  });
});

describe('postpone dates', () => {
  const now = charge(2026, 2, 5, 12, TIMEZONE_BR);

  test('rejects an earlier date, the same date, and a date after the following delivery', async () => {
    const { service, stripe } = movingService(saturdayPlan(), now);
    const before = await service.read(saturdayPlan(), 7);
    expect(before.delivery.date).toBe('2026-02-09');
    expect(before.later[0].deliveryDate).toBe('2026-03-09');
    for (const date of ['2026-02-06', '2026-02-09', '2026-03-10', undefined]) {
      await expect(service.reschedule(saturdayPlan(), 7, { deliveryId: 'current', date }))
        .rejects.toMatchObject({ statusCode: 422, details: { code: 'date_not_allowed' } });
    }
    expect(stripe.setTrialEnd).not.toHaveBeenCalled();
  });

  test('an allowed later date sets midnight of its preparation day and keeps that delivery date', async () => {
    const { service, stripe } = movingService(saturdayPlan(), now);
    const before = await service.read(saturdayPlan(), 7);
    const chosen = before.offeredDates.find((offer) => offer.deliveryDate === '2026-02-12');
    expect(chosen).toMatchObject({ preparationDay: '2026-02-12', contractEnd: '2026-03-12' });
    const after = await service.reschedule(saturdayPlan(), 7, { deliveryId: 'current', date: '2026-02-12' });
    expect(stripe.setTrialEnd).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      trial_end: unix(2026, 2, 12, TIMEZONE_BR),
      proration_behavior: 'none'
    });
    expect(stripe.pauseSubscription).not.toHaveBeenCalled();
    expect(after.delivery.date).toBe('2026-02-12');
    expect(after.contractEnd).toBe(chosen.contractEnd);
    expect(after.stripeChanged).toBe(true);
  });

  test('each offered date carries the contract end it would produce', () => {
    const read = buildDeliveryRead({ ...saturdayPlan(), rows, now });
    expect(read.contractEnd).toBe('2026-03-09');
    expect(read.offeredDates[0]).toMatchObject({ deliveryDate: '2026-02-10', contractEnd: '2026-03-10' });
    expect(read.offeredDates.find((offer) => offer.deliveryDate === '2026-02-12').contractEnd).toBe('2026-03-12');
  });

  test('8 and 9 February 2027 are not Brazil delivery dates', () => {
    const read = buildDeliveryRead({
      ...saturdayPlan({ chargeAt: charge(2027, 2, 3, 14, TIMEZONE_BR) }),
      rows,
      now: charge(2027, 1, 30, 12, TIMEZONE_BR)
    });
    const dates = read.offeredDates.map((offer) => offer.deliveryDate);
    expect(read.delivery.date).toBe('2027-02-04');
    expect(dates).toContain('2027-02-10');
    expect(dates).not.toContain('2027-02-08');
    expect(dates).not.toContain('2027-02-09');
    expect(dates).not.toContain('2027-02-07');
  });

  test('United States preparation on 23 November delivers on the 25th and the 24th and 25th are not offered', () => {
    const read = buildDeliveryRead({
      ...saturdayPlan({ market: 'US', transitDays: 1, chargeAt: charge(2026, 11, 16, 10, TIMEZONE_US) }),
      rows,
      now: charge(2026, 11, 10, 12, TIMEZONE_US)
    });
    expect(read.delivery.date).toBe('2026-11-19');
    expect(read.offeredDates).toContainEqual(expect.objectContaining({ deliveryDate: '2026-11-25', preparationDay: '2026-11-23' }));
    const preps = read.offeredDates.map((offer) => offer.preparationDay);
    expect(preps).not.toContain('2026-11-24');
    expect(preps).not.toContain('2026-11-25');
  });

  test('United States preparation on 22 December delivers on the 24th and the 23rd is not offered', () => {
    const read = buildDeliveryRead({
      ...saturdayPlan({ market: 'US', transitDays: 1, chargeAt: charge(2026, 12, 14, 10, TIMEZONE_US) }),
      rows,
      now: charge(2026, 12, 10, 12, TIMEZONE_US)
    });
    expect(read.delivery.date).toBe('2026-12-17');
    expect(read.offeredDates).toContainEqual(expect.objectContaining({ deliveryDate: '2026-12-24', preparationDay: '2026-12-22' }));
    expect(read.offeredDates.map((offer) => offer.preparationDay)).not.toContain('2026-12-23');
  });

  test('a past preparation day and one whose midnight is now are not offered', () => {
    const offers = offerDates({
      market: 'BR',
      rows,
      transitDays: 0,
      timeZone: TIMEZONE_BR,
      fromPreparationDay: '2026-02-09',
      afterDate: '2026-02-09',
      throughDate: '2026-03-09',
      now: wallTimeToUtc(2026, 2, 11, 0, 0, 0, TIMEZONE_BR),
      remaining: 2
    });
    const preps = offers.map((offer) => offer.preparationDay);
    expect(preps).not.toContain('2026-02-10');
    expect(preps).not.toContain('2026-02-11');
    expect(preps[0]).toBe('2026-02-12');
  });

  test('two preparation days for one delivery date keep the later day', () => {
    expect(keepLaterPreparation([
      { deliveryDate: '2026-11-25', preparationDay: '2026-11-23' },
      { deliveryDate: '2026-11-25', preparationDay: '2026-11-20' },
      { deliveryDate: '2026-11-20', preparationDay: '2026-11-18' }
    ])).toEqual([
      { deliveryDate: '2026-11-20', preparationDay: '2026-11-18' },
      { deliveryDate: '2026-11-25', preparationDay: '2026-11-23' }
    ]);
  });
});

describe('skip', () => {
  const now = charge(2026, 2, 5, 12, TIMEZONE_BR);

  test('moves the charge to midnight of the next valid preparation day without pausing', async () => {
    const { service, stripe } = movingService(saturdayPlan(), now);
    const after = await service.skip(saturdayPlan(), 7, { deliveryId: 'current' });
    // The following charge is Saturday 7 March at 14:00: Saturday midnight is past and Sunday is closed.
    expect(stripe.setTrialEnd).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      trial_end: unix(2026, 3, 9, TIMEZONE_BR),
      proration_behavior: 'none'
    });
    expect(stripe.pauseSubscription).not.toHaveBeenCalled();
    expect(after.delivery.date).toBe('2026-03-09');
    expect(after.stripeChanged).toBe(true);
  });

  test('a skip on a 3 month term with one charged delivery leaves two deliveries remaining', async () => {
    const { service } = movingService(saturdayPlan({ termMonths: 3, chargedCount: 1 }), now);
    const before = await service.read(saturdayPlan(), 7);
    expect(before.contractEnd).toBe('2026-03-09');
    expect(before.contractEndIfSkip).toBe('2026-04-09');
    const after = await service.skip(saturdayPlan(), 7, { deliveryId: 'current' });
    expect([after.delivery.date, ...after.later.map((item) => item.deliveryDate)]).toEqual(['2026-03-09', '2026-04-09']);
    expect(after.contractEnd).toBe(before.contractEndIfSkip);
  });

  test('a United States skip whose preparation would be a Thursday moves to the next valid Monday', async () => {
    const plan = saturdayPlan({ market: 'US', transitDays: 1, chargeAt: wallTimeToUtc(2026, 5, 4, 0, 0, 0, TIMEZONE_US) });
    const { service, stripe } = movingService(plan, charge(2026, 4, 30, 12, TIMEZONE_US));
    await service.skip(plan, 7, { deliveryId: 'current' });
    const sent = stripe.setTrialEnd.mock.calls[0][0];
    expect(sent.trial_end).toBe(unix(2026, 6, 8, TIMEZONE_US));
    expect(new Date('2026-06-08T00:00:00Z').getUTCDay()).toBe(1);
    expect(sent.proration_behavior).toBe('none');
  });

  test('only the current delivery of an active or trialing plan can be skipped', async () => {
    const { service, stripe } = movingService(saturdayPlan(), now);
    await expect(service.skip(saturdayPlan(), 7, { deliveryId: 'following' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'delivery_locked' } });
    await expect(service.skip(saturdayPlan({ status: 'canceled' }), 7, { deliveryId: 'current' }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'subscription_not_active' } });
    expect(stripe.setTrialEnd).not.toHaveBeenCalled();
    await expect(service.skip(saturdayPlan({ status: 'trialing' }), 7, { deliveryId: 'current' }))
      .resolves.toMatchObject({ stripeChanged: true });
  });
});
