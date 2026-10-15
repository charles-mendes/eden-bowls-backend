const { assessImpact, prepMidnight, MOVES } = require('../src/services/delivery-calendar-impact.service');

const NOW = new Date('2027-12-10T15:00:00Z');
const TZ = 'America/New_York';
const closeDay = (closedOn) => ({ market: 'US', closedOn, type: 'adhoc', active: true, closesPreparation: true, closesPickup: true, closesDelivery: true });

function sub(overrides = {}) {
  return {
    stripeSubscriptionId: 'sub_1', ledgerId: 1, userId: 7, market: 'US', status: 'active',
    chargeAt: new Date('2027-12-20T15:00:00Z'), termMonths: 1, chargedCount: null, transitDays: 1,
    productionStatus: 'to_prepare', pendingDeliveryChanges: null, paidCycle: null, ...overrides
  };
}

describe('assessImpact', () => {
  test('a renewal at period end moves by projection only', () => {
    const [item] = assessImpact({ subscriptions: [sub()], rowsBefore: [], rowsAfter: [closeDay('2027-12-21')], now: NOW });
    expect(item).toMatchObject({ preparationDay: '2027-12-21', newPreparationDay: '2027-12-22', move: MOVES.PROJECTION_ONLY, locked: false });
  });

  test('a trialing charge at 00:00 of the preparation day gets a Stripe sync', () => {
    const chargeAt = prepMidnight('2027-12-21', TZ);
    const [item] = assessImpact({ subscriptions: [sub({ status: 'trialing', chargeAt })], rowsBefore: [], rowsAfter: [closeDay('2027-12-21')], now: NOW });
    expect(item).toMatchObject({ move: MOVES.STRIPE_SYNC, expectedTrialEnd: chargeAt.toISOString(), targetTrialEnd: prepMidnight('2027-12-22', TZ).toISOString() });
  });

  test('a locked production status and a day that stays valid', () => {
    const [locked] = assessImpact({ subscriptions: [sub({ productionStatus: 'in_production' })], rowsBefore: [], rowsAfter: [closeDay('2027-12-21')], now: NOW });
    expect(locked).toMatchObject({ locked: true, lockReason: 'in_production' });
    expect(assessImpact({ subscriptions: [sub()], rowsBefore: [], rowsAfter: [closeDay('2027-12-28')], now: NOW })).toEqual([]);
  });

  test('a pending charge move of the following delivery is rewritten, not synced', () => {
    const pendingAt = prepMidnight('2027-12-21', TZ);
    const subscription = sub({
      chargeAt: new Date('2027-12-10T20:00:00Z'),
      termMonths: 3,
      chargedCount: 1,
      pendingDeliveryChanges: { charge_move: { kind: 'reschedule', trial_end: Math.floor(pendingAt.getTime() / 1000) } }
    });
    const items = assessImpact({ subscriptions: [subscription], rowsBefore: [], rowsAfter: [closeDay('2027-12-21')], now: NOW });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      deliveryId: 'following',
      move: MOVES.PENDING_CHANGE,
      locked: false,
      newPreparationDay: '2027-12-22',
      pendingTrialEnd: { previous: pendingAt.toISOString(), next: prepMidnight('2027-12-22', TZ).toISOString() }
    });
  });

  test('the current delivery past its edit deadline is locked', () => {
    const subscription = sub({ chargeAt: new Date('2027-12-10T20:00:00Z') });
    const [item] = assessImpact({ subscriptions: [subscription], rowsBefore: [], rowsAfter: [closeDay('2027-12-13')], now: NOW });
    expect(item).toMatchObject({ deliveryId: 'current', preparationDay: '2027-12-13', locked: true, lockReason: 'past_editable_until' });
  });

  test('a paid delivery on its way is locked', () => {
    const subscription = sub({
      chargeAt: new Date('2028-01-20T15:00:00Z'),
      chargedCount: 0,
      paidCycle: { status: 'to_prepare', preparationDay: '2027-12-13', deliveryDate: '2027-12-15' }
    });
    const items = assessImpact({ subscriptions: [subscription], rowsBefore: [], rowsAfter: [closeDay('2027-12-13')], now: NOW });
    expect(items).toEqual([expect.objectContaining({ preparationDay: '2027-12-13', locked: true, lockReason: 'paid' })]);
  });

  test('Brazil follows its own rule: only a preparation closure moves a delivery', () => {
    const subscription = sub({ market: 'BR', transitDays: null, chargeAt: new Date('2027-02-05T15:00:00Z') });
    const brDay = (flags) => ({ market: 'BR', closedOn: '2027-02-06', type: 'regional', active: true, ...flags });
    const pickupOnly = assessImpact({ subscriptions: [subscription], rowsBefore: [], rowsAfter: [brDay({ closesPreparation: false, closesPickup: true, closesDelivery: true })], now: new Date('2027-01-20T12:00:00Z') });
    expect(pickupOnly).toEqual([]);
    const [item] = assessImpact({ subscriptions: [subscription], rowsBefore: [], rowsAfter: [brDay({ closesPreparation: true, closesPickup: false, closesDelivery: false })], now: new Date('2027-01-20T12:00:00Z') });
    expect(item).toMatchObject({ preparationDay: '2027-02-06', newPreparationDay: '2027-02-08', move: MOVES.PROJECTION_ONLY });
  });

  test('no subscriptions, no affected deliveries', () => {
    expect(assessImpact({ subscriptions: [], rowsBefore: [], rowsAfter: [closeDay('2027-12-21')], now: NOW })).toEqual([]);
  });
});
