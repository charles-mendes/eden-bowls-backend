const { HttpError } = require('../core/http-error');
const {
  MAX_TRANSIT_DAYS_US,
  addCalendarDays,
  addressUnavailable,
  brazilPrepValid,
  assessUsCalendar,
  dateKey,
  deliveryForPrep,
  editableUntil,
  firstPrepDay,
  timeZoneFor,
  usPrepValid,
  wallTimeToUtc,
  zonedParts
} = require('../core/delivery-closed-days');
const { assertVerifiedDeliveryArea } = require('../core/shipping-quote-token');

const LOCKED_STATUSES = new Set(['in_production', 'ready', 'blocked']);
const EDITABLE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);

const STATUS_LABELS = {
  in_production: 'Em preparo',
  ready: 'Pronto para envio'
};

function addMonths(instant, months, timeZone) {
  const parts = zonedParts(instant, timeZone);
  const shifted = new Date(Date.UTC(parts.year, parts.month - 1 + months, parts.day));
  return wallTimeToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    parts.hour,
    parts.minute,
    parts.second,
    timeZone
  );
}

function presentDate(parts) {
  if (!parts) return null;
  return dateKey(parts.year, parts.month, parts.day);
}

function projectOne(market, chargeAt, rows, transitDays) {
  const prep = firstPrepDay(market, chargeAt, rows, transitDays);
  if (!prep) return null;
  return {
    chargeAt,
    preparationDay: presentDate(prep),
    deliveryDate: presentDate(deliveryForPrep(market, prep, transitDays))
  };
}

function series(market, chargeAt, rows, transitDays, count, timeZone) {
  const deliveries = [];
  for (let index = 0; index < count; index += 1) {
    const projected = projectOne(market, addMonths(chargeAt, index, timeZone), rows, transitDays);
    if (projected) deliveries.push(projected);
  }
  return deliveries;
}

function contractEndFrom(market, chargeAt, rows, transitDays, remaining, timeZone) {
  const planned = series(market, chargeAt, rows, transitDays, remaining, timeZone);
  return planned.length ? planned[planned.length - 1].deliveryDate : null;
}

function partsOf(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { year, month, day };
}

function prepMidnight(preparationDay, timeZone) {
  const [year, month, day] = preparationDay.split('-').map(Number);
  return wallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
}

function keepLaterPreparation(offers) {
  const byDate = new Map();
  for (const offer of offers) {
    const kept = byDate.get(offer.deliveryDate);
    if (!kept || offer.preparationDay > kept.preparationDay) {
      byDate.set(offer.deliveryDate, offer);
    }
  }
  return [...byDate.values()].sort((left, right) => left.deliveryDate.localeCompare(right.deliveryDate));
}

// Postpone choices are projected forward from each valid preparation day, never shifted after confirm.
function offerDates({ market, rows, transitDays, timeZone, fromPreparationDay, afterDate, throughDate, now, remaining }) {
  const [year, month, day] = fromPreparationDay.split('-').map(Number);
  const offers = [];
  for (let offset = 1; offset < 40; offset += 1) {
    const candidate = addCalendarDays(year, month, day, offset);
    const valid = market === 'BR'
      ? brazilPrepValid(candidate, rows)
      : usPrepValid(candidate, rows, transitDays);
    if (!valid) continue;
    const deliveryDate = presentDate(deliveryForPrep(market, candidate, transitDays));
    if (deliveryDate <= afterDate) continue;
    if (deliveryDate > throughDate) break;
    const midnight = wallTimeToUtc(candidate.year, candidate.month, candidate.day, 0, 0, 0, timeZone);
    if (now && midnight.getTime() <= now.getTime()) continue;
    offers.push({
      deliveryDate,
      preparationDay: presentDate(candidate),
      contractEnd: remaining == null ? null : contractEndFrom(market, midnight, rows, transitDays, remaining, timeZone)
    });
  }
  return keepLaterPreparation(offers);
}

function planSkip({ market, rows, transitDays, chargeAt, now }) {
  const timeZone = timeZoneFor(market);
  return planBlockTrialEnd({
    market,
    rows,
    transitDays,
    followingChargeAt: addMonths(chargeAt, 1, timeZone),
    now,
    alreadyCharged: false,
    returning: false
  });
}

// What skip and postpone would do to the delivery charged at `chargeAt`, with `remaining` contracted
// deliveries from that one on. Postpone dates run after that delivery and not past the one after it.
function targetPlans({ market, rows, transitDays, timeZone, chargeAt, projected, remaining, now }) {
  const skipPlan = planSkip({ market, rows, transitDays, chargeAt, now });
  const skipChargeAt = skipPlan.stripeUpdate ? new Date(skipPlan.stripeUpdate.trial_end * 1000) : null;
  const after = projectOne(market, addMonths(chargeAt, 1, timeZone), rows, transitDays);
  return {
    skipPlan,
    contractEndIfSkip: remaining != null && remaining > 0 && skipChargeAt
      ? contractEndFrom(market, skipChargeAt, rows, transitDays, remaining, timeZone)
      : null,
    // The delivery a skip lands on, so the confirmation can name it before the customer commits.
    nextDeliveryIfSkip: skipPlan.preparationDay
      ? presentDate(deliveryForPrep(market, partsOf(skipPlan.preparationDay), transitDays))
      : null,
    offeredDates: projected && after
      ? offerDates({
        market,
        rows,
        transitDays,
        timeZone,
        fromPreparationDay: projected.preparationDay,
        afterDate: projected.deliveryDate,
        throughDate: after.deliveryDate,
        now,
        remaining
      })
      : []
  };
}

// The paid delivery still on its way is the current one: locked, with the date its payment produced. The next
// renewal becomes the following delivery and carries the actions; Stripe can move it at once.
function withPaidCycle(base, input) {
  const paid = input.paidCycle;
  const termMonths = Number(input.termMonths) || 0;
  const contractOver = input.chargedCount !== null && termMonths - (Number(input.chargedCount) || 0) <= 0;
  const status = paid.status || 'to_prepare';
  const delivery = {
    id: 'current',
    date: paid.deliveryDate,
    preparationDay: paid.preparationDay,
    packs: input.packsPerMonth,
    locked: true,
    actions: false,
    paid: true,
    status,
    statusLabel: STATUS_LABELS[status] || null
  };
  if (base.delivery.price != null) delivery.price = base.delivery.price;
  if (base.delivery.unavailable) {
    delivery.unavailable = true;
    delivery.message = base.delivery.message;
  }
  if (contractOver) {
    return { ...base, delivery, actionTarget: null, later: [], contractEnd: paid.deliveryDate,
      contractEndIfSkip: null, nextDeliveryIfSkip: null, offeredDates: [], targetChargeAt: null };
  }
  const next = base.delivery.date ? [{
    chargeAt: input.chargeAt,
    preparationDay: base.delivery.preparationDay,
    deliveryDate: base.delivery.date,
    packs: base.delivery.packs,
    ...(base.delivery.price != null ? { price: base.delivery.price } : {})
  }] : [];
  const targetsNext = Boolean(base.actionTarget && base.actionTarget.id === base.delivery.id);
  return {
    ...base,
    delivery,
    later: [...next, ...base.later],
    actionTarget: targetsNext ? { ...base.actionTarget, id: 'following' } : null,
    contractEndIfSkip: targetsNext ? base.contractEndIfSkip : null,
    nextDeliveryIfSkip: targetsNext ? base.nextDeliveryIfSkip : null,
    offeredDates: targetsNext ? base.offeredDates : [],
    targetChargeAt: targetsNext ? input.chargeAt : null
  };
}

function buildDeliveryRead(input) {
  if (input.paidCycle && input.paidCycle.deliveryDate) {
    return withPaidCycle(buildDeliveryRead({ ...input, paidCycle: null }), input);
  }
  const market = input.market;
  const timeZone = timeZoneFor(market);
  const termMonths = Number(input.termMonths) || 0;
  // null means the charged deliveries could not be counted, so only the next delivery is projected.
  const contractKnown = input.chargedCount !== null;
  const chargedCount = Number(input.chargedCount) || 0;
  const remaining = contractKnown ? Math.max(0, termMonths - chargedCount) : 1;
  const transitDays = Number(input.transitDays);
  const transit = transitDays || 0;
  const unavailable = addressUnavailable(market, {
    distanceKm: input.distanceKm,
    transitDays
  });
  const rows = input.rows || [];
  const projectable = Boolean(timeZone && input.chargeAt && !unavailable);
  const pending = input.pendingDeliveryChanges || null;
  const pendingMove = pending && pending.charge_move && Number(pending.charge_move.trial_end) > 0
    ? new Date(Number(pending.charge_move.trial_end) * 1000)
    : null;
  const pendingPacks = pending && pending.packs ? pending.packs : null;
  // The charge after the current one: the next renewal, or the one a pending change already moved.
  const followingChargeAt = projectable ? (pendingMove || addMonths(input.chargeAt, 1, timeZone)) : null;
  const planned = projectable && remaining > 0
    ? series(market, input.chargeAt, rows, transit, remaining, timeZone)
    : [];
  const next = planned[0] || null;
  const productionDate = input.productionDate || null;
  const nextDeliveryDate = productionDate || (next && next.deliveryDate) || null;
  const deadline = timeZone && input.chargeAt ? editableUntil(input.chargeAt, timeZone) : null;
  const status = input.productionStatus || 'to_prepare';
  const pastDeadline = Boolean(deadline && input.now && input.now.getTime() > deadline.getTime());
  const statusLocked = LOCKED_STATUSES.has(status);
  const locked = !timeZone || unavailable || pastDeadline || statusLocked || !nextDeliveryDate;
  const actions = Boolean(timeZone) && !unavailable && !pastDeadline && !statusLocked && Boolean(nextDeliveryDate);
  const hasPrice = input.subtotal != null && input.subtotal !== '';
  const laterPacks = pendingPacks && pendingPacks.packs_per_month != null ? pendingPacks.packs_per_month : input.packsPerMonth;
  const laterPrice = pendingPacks && pendingPacks.subtotal != null ? pendingPacks.subtotal : (hasPrice ? input.subtotal : null);
  const laterProjected = pendingMove && remaining > 1
    ? series(market, pendingMove, rows, transit, remaining - 1, timeZone)
    : planned.slice(1);
  const later = laterProjected.map((projected) => ({
    ...projected,
    packs: laterPacks,
    ...(laterPrice != null ? { price: laterPrice } : {})
  }));
  const lastPlanned = later.length ? later[later.length - 1] : next;
  const contractEnd = contractKnown && lastPlanned ? lastPlanned.deliveryDate : null;

  const delivery = {
    id: input.deliveryId || 'current',
    date: nextDeliveryDate,
    preparationDay: next && next.preparationDay,
    packs: input.packsPerMonth,
    locked,
    actions,
    status,
    statusLabel: STATUS_LABELS[status] || null
  };
  if (deadline && timeZone) {
    delivery.editableUntil = deadline.toISOString();
    delivery.timezone = timeZone;
  }
  if (hasPrice) {
    delivery.price = input.subtotal;
  }
  if (unavailable) {
    delivery.unavailable = true;
    delivery.message = 'O endereço está fora da área de entrega.';
  }

  // Skip, postpone, and packs act on one delivery: the current one while it is editable, otherwise the
  // following one while that one is still before its own deadline.
  let actionTarget = null;
  let plans = { contractEndIfSkip: null, nextDeliveryIfSkip: null, offeredDates: [] };
  if (actions) {
    actionTarget = {
      id: delivery.id,
      date: delivery.date,
      packs: delivery.packs,
      editableUntil: delivery.editableUntil,
      timezone: delivery.timezone,
      ...(hasPrice ? { price: input.subtotal } : {})
    };
    plans = targetPlans({
      market,
      rows,
      transitDays: transit,
      timeZone,
      chargeAt: input.chargeAt,
      projected: next ? { preparationDay: next.preparationDay, deliveryDate: nextDeliveryDate } : null,
      remaining: contractKnown ? remaining : null,
      now: input.now
    });
  } else if (timeZone && !unavailable && (statusLocked || pastDeadline) && later[0]) {
    const followingDeadline = editableUntil(followingChargeAt, timeZone);
    if (!input.now || input.now.getTime() <= followingDeadline.getTime()) {
      actionTarget = {
        id: 'following',
        date: later[0].deliveryDate,
        packs: later[0].packs,
        editableUntil: followingDeadline.toISOString(),
        timezone: timeZone,
        ...(later[0].price != null ? { price: later[0].price } : {})
      };
      // The current delivery stays; the contracted count from the following one on is one less.
      plans = targetPlans({
        market,
        rows,
        transitDays: transit,
        timeZone,
        chargeAt: followingChargeAt,
        projected: later[0],
        remaining: contractKnown ? remaining - 1 : null,
        now: input.now
      });
    }
  }

  return {
    stripeChanged: false,
    ignoredShipmentDate: input.nextShipmentDate && productionDate && input.nextShipmentDate !== productionDate
      ? input.nextShipmentDate
      : null,
    delivery,
    actionTarget,
    later,
    contractEnd,
    contractEndIfSkip: plans.contractEndIfSkip,
    nextDeliveryIfSkip: plans.nextDeliveryIfSkip,
    offeredDates: plans.offeredDates,
    pendingChange: pending ? {
      ...(pending.charge_move ? { kind: pending.charge_move.kind } : {}),
      ...(pendingPacks ? { packs: true } : {})
    } : null,
    // Internal: the charge the target delivery is billed at, and whether Stripe can move it now.
    targetChargeAt: actionTarget ? (actionTarget.id === delivery.id ? input.chargeAt : followingChargeAt) : null
  };
}

function planBlockTrialEnd({
  market,
  rows,
  transitDays,
  followingChargeAt,
  originalPreparationDay,
  now,
  alreadyCharged,
  returning
}) {
  if (alreadyCharged) {
    return { stripeUpdate: null, refund: false, invoice: false };
  }
  const timeZone = timeZoneFor(market);
  let prep = null;
  if (returning && originalPreparationDay) {
    const [year, month, day] = originalPreparationDay.split('-').map(Number);
    prep = { year, month, day };
    const valid = market === 'US'
      ? usPrepValid(prep, rows, transitDays)
      : brazilPrepValid(prep, rows);
    if (!valid) {
      const midnight = wallTimeToUtc(year, month, day, 0, 0, 0, timeZone);
      prep = firstPrepDay(market, new Date(midnight.getTime() + 1000), rows, transitDays);
    }
  } else {
    prep = firstPrepDay(market, followingChargeAt, rows, transitDays);
  }
  if (!prep) {
    return { stripeUpdate: null, refund: false, invoice: false };
  }
  const midnight = wallTimeToUtc(prep.year, prep.month, prep.day, 0, 0, 0, timeZone);
  if (returning && now && now.getTime() >= midnight.getTime()) {
    return {
      stripeUpdate: { trial_end: 'now', proration_behavior: 'none' },
      refund: false,
      invoice: false
    };
  }
  return {
    stripeUpdate: {
      trial_end: Math.floor(midnight.getTime() / 1000),
      proration_behavior: 'none'
    },
    preparationDay: presentDate(prep),
    refund: false,
    invoice: false
  };
}

class CustomerDeliveriesService {
  constructor(options = {}) {
    this.calendar = options.calendar || null;
    this.ups = options.ups || null;
    this.subscriptions = options.subscriptions || null;
    this.stripeAccounts = options.stripeAccounts || null;
    this.logger = options.logger || null;
    this.shippingQuoteSigner = options.shippingQuoteSigner || null;
    this.now = options.now || (() => new Date());
  }

  async loadSubscription(subscriptionId, userId) {
    if (!this.subscriptions || typeof this.subscriptions.findForUser !== 'function') {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    const subscription = await this.subscriptions.findForUser(subscriptionId, userId);
    if (!subscription) {
      throw new HttpError(404, 'Subscription not found.', { code: 'not_found' });
    }
    return subscription;
  }

  async rowsFor(market) {
    if (!this.calendar || typeof this.calendar.listActive !== 'function') {
      return [];
    }
    const rows = await this.calendar.listActive();
    return rows;
  }

  async read(subscription, userId) {
    const { body } = await this.readContext(subscription, userId);
    delete body.targetChargeAt;
    return body;
  }

  async readContext(subscription, userId) {
    this.assertOwner(subscription, userId);
    let transitDays = subscription.transitDays;
    let upsCalls = 0;
    if (subscription.market === 'US' && (transitDays == null || transitDays === '')) {
      if (this.ups && typeof this.ups.quoteTransitDays === 'function') {
        transitDays = await this.ups.quoteTransitDays(subscription);
        upsCalls += 1;
        if (typeof this.ups.storeTransitDays === 'function') {
          await this.ups.storeTransitDays(subscription, transitDays);
          subscription.transitDays = transitDays;
        }
      }
    }
    const rows = await this.rowsFor(subscription.market);
    if (subscription.market === 'US' && subscription.chargeAt) {
      assessUsCalendar(rows, zonedParts(subscription.chargeAt, timeZoneFor('US')).year, this.logger);
    }
    const body = buildDeliveryRead({
      ...subscription,
      transitDays,
      rows,
      now: this.now()
    });
    body.upsCalls = upsCalls;
    return { body, rows, transitDays: Number(transitDays) || 0 };
  }

  assertOwner(subscription, userId) {
    if (!subscription || String(subscription.userId) !== String(userId)) {
      throw new HttpError(404, 'Subscription not found.', { code: 'not_found' });
    }
  }

  // Only the delivery the read names in actionTarget can change: the current one while it is editable,
  // otherwise the following one while it is before its own deadline. Any other delivery is locked.
  assertEditable(read, deliveryId) {
    const target = read.actionTarget;
    if (!target || !deliveryId || deliveryId !== target.id) {
      throw new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' });
    }
    return target;
  }

  async guardMutation(subscription, userId, deliveryId) {
    const context = await this.readContext(subscription, userId);
    const target = this.assertEditable(context.body, deliveryId);
    if (!EDITABLE_SUBSCRIPTION_STATUSES.has(String(subscription.status || ''))) {
      throw new HttpError(409, 'This subscription is not active.', { code: 'subscription_not_active' });
    }
    // Stripe can move a charge only when it is the subscription's next renewal. The following delivery's
    // charge comes after the current one, so while the current one is unpaid the change waits for its invoice.
    const deferred = target.id !== context.body.delivery.id && !subscription.currentPaid;
    return { ...context, target, deferred };
  }

  async skip(subscription, userId, { deliveryId } = {}) {
    const context = await this.guardMutation(subscription, userId, deliveryId);
    const plan = planSkip({
      market: subscription.market,
      rows: context.rows,
      transitDays: context.transitDays,
      chargeAt: context.body.targetChargeAt,
      now: this.now()
    });
    if (!plan.stripeUpdate) {
      throw new HttpError(409, 'No preparation day is available for the following delivery.', { code: 'no_preparation_day' });
    }
    return this.applyChargeMove(subscription, userId, context, plan.stripeUpdate, 'skip');
  }

  async reschedule(subscription, userId, { deliveryId, date } = {}) {
    const context = await this.guardMutation(subscription, userId, deliveryId);
    const chosen = typeof date === 'string'
      ? context.body.offeredDates.find((offer) => offer.deliveryDate === date)
      : null;
    if (!chosen) {
      throw new HttpError(422, 'This date is not available for this delivery.', { code: 'date_not_allowed' });
    }
    const midnight = prepMidnight(chosen.preparationDay, timeZoneFor(subscription.market));
    return this.applyChargeMove(subscription, userId, context, {
      trial_end: Math.floor(midnight.getTime() / 1000),
      proration_behavior: 'none'
    }, 'reschedule');
  }

  async applyChargeMove(subscription, userId, context, stripeUpdate, kind) {
    if (!context.deferred) {
      return this.moveCharge(subscription, userId, stripeUpdate);
    }
    return this.recordPending(subscription, userId, {
      charge_move: { kind, trial_end: stripeUpdate.trial_end }
    });
  }

  async recordPending(subscription, userId, change) {
    if (!this.subscriptions || typeof this.subscriptions.recordPendingChanges !== 'function') {
      throw new HttpError(503, 'Deliveries service is not available.');
    }
    const current = subscription.pendingDeliveryChanges || {};
    await this.subscriptions.recordPendingChanges(subscription, {
      ...current,
      ...change,
      after_charge_at: new Date(subscription.chargeAt).toISOString(),
      recorded_at: this.now().toISOString()
    });
    const fresh = await this.loadSubscription(subscription.id || subscription.stripeSubscriptionId, userId);
    return this.read(fresh, userId);
  }

  async moveCharge(subscription, userId, stripeUpdate) {
    const client = this.stripeAccounts ? this.stripeAccounts.get(subscription.market) : null;
    if (!client || typeof client.setTrialEnd !== 'function') {
      throw new HttpError(503, 'Stripe billing is not available for this subscription.', { code: 'stripe_unavailable' });
    }
    const updated = await client.setTrialEnd({
      subscriptionId: subscription.stripeSubscriptionId,
      ...stripeUpdate
    });
    if (this.subscriptions && typeof this.subscriptions.recordChargeMoved === 'function') {
      await this.subscriptions.recordChargeMoved(subscription, updated);
    }
    const fresh = await this.loadSubscription(subscription.id || subscription.stripeSubscriptionId, userId);
    const body = await this.read(fresh, userId);
    body.stripeChanged = true;
    return body;
  }

  // Guard for a pack save. `deferred` means the save waits for the current delivery's invoice.
  async commitPacks(subscription, userId, { deliveryId } = {}) {
    const { body, deferred } = await this.guardMutation(subscription, userId, deliveryId);
    delete body.targetChargeAt;
    return { ...body, deferred };
  }

  async recordPendingPacks(subscription, userId, packs) {
    return this.recordPending(subscription, userId, { packs });
  }

  async applyAddressChange(subscription, next = {}) {
    const quote = assertVerifiedDeliveryArea(this.shippingQuoteSigner, subscription.market, next.shipping || {}, {
      zipcode: next.zipcode
    });
    const rows = await this.rowsFor(subscription.market);
    const timeZone = timeZoneFor(subscription.market);
    const projected = projectOne(subscription.market, subscription.chargeAt, rows, Number(quote.delivery_days) || 0);
    return {
      chargeAt: subscription.chargeAt,
      editableUntil: timeZone ? editableUntil(subscription.chargeAt, timeZone).toISOString() : null,
      deliveryDate: projected && projected.deliveryDate,
      stripeChanged: false
    };
  }

  async onProductionStatus({ subscription, toStatus, fromStatus, alreadyCharged }) {
    if (toStatus !== 'blocked' && !(fromStatus === 'blocked' && toStatus === 'to_prepare')) {
      return { stripeUpdate: null, refund: false, invoice: false };
    }
    const rows = await this.rowsFor(subscription.market);
    const timeZone = timeZoneFor(subscription.market);
    const followingChargeAt = addMonths(subscription.chargeAt, 1, timeZone);
    const client = this.stripeAccounts ? this.stripeAccounts.get(subscription.market) : null;
    const plan = planBlockTrialEnd({
      market: subscription.market,
      rows,
      transitDays: Number(subscription.transitDays) || 0,
      followingChargeAt,
      originalPreparationDay: subscription.originalPreparationDay,
      now: this.now(),
      alreadyCharged,
      returning: fromStatus === 'blocked' && toStatus === 'to_prepare'
    });
    // The preparation day the cycle had before the block, so a return can restore it.
    if (toStatus === 'blocked') {
      const original = projectOne(subscription.market, subscription.chargeAt, rows, Number(subscription.transitDays) || 0);
      plan.originalPreparationDay = original ? original.preparationDay : null;
    }
    if (plan.stripeUpdate && client && typeof client.setTrialEnd === 'function') {
      const updated = await client.setTrialEnd({
        subscriptionId: subscription.stripeSubscriptionId,
        ...plan.stripeUpdate
      });
      // The ledger follows the moved charge now; the webhook confirms the same period later.
      if (this.subscriptions && typeof this.subscriptions.recordChargeMoved === 'function') {
        await this.subscriptions.recordChargeMoved(subscription, updated);
      }
    }
    return plan;
  }
}

module.exports = {
  CustomerDeliveriesService,
  LOCKED_STATUSES,
  STATUS_LABELS,
  MAX_TRANSIT_DAYS_US,
  buildDeliveryRead,
  keepLaterPreparation,
  offerDates,
  planBlockTrialEnd,
  projectOne
};
