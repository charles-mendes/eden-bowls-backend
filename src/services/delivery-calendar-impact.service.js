const {
  brazilPrepValid,
  currentUsMaxTransitDays,
  editableUntil,
  timeZoneFor,
  usPrepValid,
  wallTimeToUtc
} = require('../core/delivery-closed-days');
const { LOCKED_STATUSES, buildDeliveryRead, projectOne } = require('./customer-deliveries.service');

const MOVES = {
  STRIPE_SYNC: 'stripe_sync',
  PENDING_CHANGE: 'pending_change',
  PROJECTION_ONLY: 'projection_only'
};

// What a change of the standard week does to one scheduled delivery (delivery-calendar).
const OUTCOMES = {
  KEPT: 'kept',
  MOVED_CHARGE_KEPT: 'moved_charge_kept',
  MOVED: 'moved'
};

function partsOf(isoDate) {
  const [year, month, day] = String(isoDate).split('-').map(Number);
  return { year, month, day };
}

function prepMidnight(preparationDay, timeZone) {
  const { year, month, day } = partsOf(preparationDay);
  return wallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

function sameInstant(left, right) {
  return Boolean(left && right) && new Date(left).getTime() === new Date(right).getTime();
}

// An unknown US transit is projected at the longest transit the US market accepts, so no closure is missed.
function transitFor(subscription) {
  if (subscription.market !== 'US') return 0;
  const transit = Number(subscription.transitDays);
  return transit > 0 ? transit : currentUsMaxTransitDays();
}

function prepValid(market, preparationDay, rows, transitDays) {
  const parts = partsOf(preparationDay);
  return market === 'BR' ? brazilPrepValid(parts, rows) : usPrepValid(parts, rows, transitDays);
}

function pendingMoveAt(subscription) {
  const move = subscription.pendingDeliveryChanges && subscription.pendingDeliveryChanges.charge_move;
  return move && Number(move.trial_end) > 0 ? new Date(Number(move.trial_end) * 1000) : null;
}

// Every delivery the projection shows for a subscription with the calendar as it is: the current one (paid or
// not) and the later ones, each with the charge it is billed at when there is one.
function scheduledDeliveries(subscription, rows, now) {
  const transitDays = transitFor(subscription);
  const read = buildDeliveryRead({ ...subscription, transitDays, rows, now });
  const deliveries = [];
  if (read.delivery && read.delivery.preparationDay) {
    deliveries.push({
      id: read.delivery.id,
      chargeAt: read.delivery.paid ? null : subscription.chargeAt,
      preparationDay: read.delivery.preparationDay,
      deliveryDate: read.delivery.date,
      paid: Boolean(read.delivery.paid)
    });
  }
  (read.later || []).forEach((item, index) => {
    deliveries.push({
      id: index === 0 ? 'following' : `later-${index}`,
      chargeAt: item.chargeAt || null,
      preparationDay: item.preparationDay,
      deliveryDate: item.deliveryDate,
      paid: false
    });
  });
  return { deliveries, transitDays };
}

function lockReason(subscription, delivery, timeZone, now) {
  if (delivery.paid) return 'paid';
  const ledgerCharge = sameInstant(delivery.chargeAt, subscription.chargeAt);
  if (ledgerCharge && LOCKED_STATUSES.has(subscription.productionStatus)) return subscription.productionStatus;
  if (delivery.chargeAt && now.getTime() > editableUntil(new Date(delivery.chargeAt), timeZone).getTime()) {
    return 'past_editable_until';
  }
  return null;
}

// How an affected delivery moves. Only a trialing charge at 00:00 of the old preparation day is a value Stripe
// holds for that day; a pending charge move to that day is a value MySQL holds until invoice.paid applies it.
function moveFor(subscription, delivery, timeZone) {
  const oldMidnight = prepMidnight(delivery.preparationDay, timeZone);
  if (subscription.status === 'trialing'
    && sameInstant(delivery.chargeAt, subscription.chargeAt)
    && sameInstant(subscription.chargeAt, oldMidnight)) {
    return MOVES.STRIPE_SYNC;
  }
  const pending = pendingMoveAt(subscription);
  if (pending && sameInstant(delivery.chargeAt, pending) && sameInstant(pending, oldMidnight)) {
    return MOVES.PENDING_CHANGE;
  }
  return MOVES.PROJECTION_ONLY;
}

function assessSubscription(subscription, { rowsBefore, rowsAfter, now }) {
  const market = subscription.market;
  const timeZone = timeZoneFor(market);
  if (!timeZone || !subscription.chargeAt) return [];
  const { deliveries, transitDays } = scheduledDeliveries(subscription, rowsBefore, now);
  const affected = [];
  for (const delivery of deliveries) {
    if (!prepValid(market, delivery.preparationDay, rowsBefore, transitDays)) continue;
    if (prepValid(market, delivery.preparationDay, rowsAfter, transitDays)) continue;

    const reason = lockReason(subscription, delivery, timeZone, now);
    const from = delivery.chargeAt
      ? new Date(Math.max(new Date(delivery.chargeAt).getTime(), prepMidnight(delivery.preparationDay, timeZone).getTime()))
      : prepMidnight(delivery.preparationDay, timeZone);
    const moved = projectOne(market, from, rowsAfter, transitDays);
    const item = {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      ledgerId: subscription.ledgerId,
      userId: subscription.userId,
      deliveryId: delivery.id,
      preparationDay: delivery.preparationDay,
      deliveryDate: delivery.deliveryDate,
      newPreparationDay: moved ? moved.preparationDay : null,
      newDeliveryDate: moved ? moved.deliveryDate : null,
      locked: Boolean(reason) || !moved,
      lockReason: reason || (moved ? null : 'no_preparation_day'),
      move: moveFor(subscription, delivery, timeZone)
    };
    if (moved && item.move === MOVES.STRIPE_SYNC) {
      item.expectedTrialEnd = new Date(subscription.chargeAt).toISOString();
      item.targetTrialEnd = prepMidnight(moved.preparationDay, timeZone).toISOString();
    }
    if (moved && item.move === MOVES.PENDING_CHANGE) {
      item.pendingTrialEnd = {
        previous: pendingMoveAt(subscription).toISOString(),
        next: prepMidnight(moved.preparationDay, timeZone).toISOString()
      };
    }
    affected.push(item);
  }
  return affected;
}

// The deliveries a calendar write would move: those whose preparation day is valid with `rowsBefore` and not
// with `rowsAfter`. It reads only; nothing is stored and Stripe is not called.
function assessImpact({ subscriptions, rowsBefore, rowsAfter, now }) {
  return (subscriptions || []).flatMap((subscription) => assessSubscription(subscription, { rowsBefore, rowsAfter, now }));
}

// The outcome of a delivery a week change reaches: paid, in production, ready or blocked keeps its stored date;
// unpaid past the edit deadline keeps its charge and moves preparation and delivery; anything else moves.
function weekOutcome(reason) {
  if (reason === 'paid' || LOCKED_STATUSES.has(reason)) return OUTCOMES.KEPT;
  if (reason === 'past_editable_until') return OUTCOMES.MOVED_CHARGE_KEPT;
  return OUTCOMES.MOVED;
}

function assessWeekSubscription(subscription, { before, after, now }) {
  const market = subscription.market;
  const timeZone = timeZoneFor(market);
  if (!timeZone || !subscription.chargeAt) return [];
  const { deliveries, transitDays } = scheduledDeliveries(subscription, before, now);
  const projectedAfter = new Map(scheduledDeliveries(subscription, after, now).deliveries.map((item) => [item.id, item]));
  const affected = [];
  for (const delivery of deliveries) {
    const next = projectedAfter.get(delivery.id);
    const reason = lockReason(subscription, delivery, timeZone, now);
    const outcome = weekOutcome(reason);
    const changes = next && next.preparationDay !== delivery.preparationDay;
    // A kept delivery shows when the week would have moved it: its projection changes or its stored day closes.
    const reached = outcome === OUTCOMES.KEPT
      ? changes || !prepValid(market, delivery.preparationDay, after, transitDays)
      : changes;
    if (!reached) continue;
    const item = {
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      ledgerId: subscription.ledgerId,
      userId: subscription.userId,
      deliveryId: delivery.id,
      chargeAt: delivery.chargeAt ? new Date(delivery.chargeAt).toISOString() : null,
      preparationDay: delivery.preparationDay,
      deliveryDate: delivery.deliveryDate,
      newPreparationDay: outcome === OUTCOMES.KEPT ? delivery.preparationDay : next.preparationDay,
      newDeliveryDate: outcome === OUTCOMES.KEPT ? delivery.deliveryDate : next.deliveryDate,
      outcome,
      lockReason: reason,
      // Only a `moved` charge held at 00:00 of its preparation day moves in Stripe (or in a pending change).
      move: outcome === OUTCOMES.MOVED ? moveFor(subscription, delivery, timeZone) : MOVES.PROJECTION_ONLY
    };
    if (item.move === MOVES.STRIPE_SYNC) {
      item.expectedTrialEnd = new Date(subscription.chargeAt).toISOString();
      item.targetTrialEnd = prepMidnight(item.newPreparationDay, timeZone).toISOString();
    }
    if (item.move === MOVES.PENDING_CHANGE) {
      item.pendingTrialEnd = {
        previous: pendingMoveAt(subscription).toISOString(),
        next: prepMidnight(item.newPreparationDay, timeZone).toISOString()
      };
    }
    affected.push(item);
  }
  return affected;
}

// The deliveries a change of the standard week reaches: every scheduled delivery whose projected preparation day
// differs between `before` and `after` (snapshots that differ only in the week), earlier or later, plus the
// kept ones whose stored day stops preparing. It reads only.
function assessWeekImpact({ subscriptions, before, after, now }) {
  return (subscriptions || []).flatMap((subscription) => assessWeekSubscription(subscription, { before, after, now }));
}

class DeliveryCalendarImpactService {
  constructor(options = {}) {
    this.subscriptions = options.subscriptions;
    this.now = options.now || (() => new Date());
  }

  async assess({ market, rowsBefore, rowsAfter }) {
    const subscriptions = await this.subscriptions.listForMarket(market);
    return assessImpact({
      subscriptions: subscriptions.filter((item) => item.market === market),
      rowsBefore,
      rowsAfter,
      now: this.now()
    });
  }

  async assessWeek({ market, before, after }) {
    const subscriptions = await this.subscriptions.listForMarket(market);
    return assessWeekImpact({
      subscriptions: subscriptions.filter((item) => item.market === market),
      before,
      after,
      now: this.now()
    });
  }
}

module.exports = {
  MOVES,
  OUTCOMES,
  assessWeekImpact,
  DeliveryCalendarImpactService,
  assessImpact,
  prepMidnight
};
