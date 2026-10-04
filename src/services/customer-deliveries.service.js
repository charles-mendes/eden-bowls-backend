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

function buildDeliveryRead(input) {
  const market = input.market;
  const timeZone = timeZoneFor(market);
  const termMonths = Number(input.termMonths) || 0;
  // null means the charged deliveries could not be counted, so only the next delivery is projected.
  const contractKnown = input.chargedCount !== null;
  const chargedCount = Number(input.chargedCount) || 0;
  const remaining = contractKnown ? Math.max(0, termMonths - chargedCount) : 1;
  const transitDays = Number(input.transitDays);
  const unavailable = addressUnavailable(market, {
    distanceKm: input.distanceKm,
    transitDays
  });
  const rows = input.rows || [];
  const planned = timeZone && input.chargeAt && !unavailable && remaining > 0
    ? series(market, input.chargeAt, rows, transitDays || 0, remaining, timeZone)
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
  const later = planned.slice(1).map((projected) => ({
    ...projected,
    packs: input.packsPerMonth,
    ...(hasPrice ? { price: input.subtotal } : {})
  }));
  const contractEnd = contractKnown && planned.length ? planned[planned.length - 1].deliveryDate : null;
  // A skip moves the charge to 00:00 of the following delivery's preparation day; renewals follow from there.
  const skipPlan = timeZone && input.chargeAt && !unavailable
    ? planSkip({ market, rows, transitDays: transitDays || 0, chargeAt: input.chargeAt, now: input.now })
    : null;
  const skipChargeAt = skipPlan && skipPlan.stripeUpdate ? new Date(skipPlan.stripeUpdate.trial_end * 1000) : null;
  const contractEndIfSkip = contractKnown && skipChargeAt && remaining > 0
    ? contractEndFrom(market, skipChargeAt, rows, transitDays || 0, remaining, timeZone)
    : null;
  const following = timeZone && input.chargeAt && !unavailable
    ? projectOne(market, addMonths(input.chargeAt, 1, timeZone), rows, transitDays || 0)
    : null;
  const offered = actions && next && following
    ? offerDates({
      market,
      rows,
      transitDays: transitDays || 0,
      timeZone,
      fromPreparationDay: next.preparationDay,
      afterDate: nextDeliveryDate,
      throughDate: following.deliveryDate,
      now: input.now,
      remaining: contractKnown ? remaining : null
    })
    : [];

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

  let actionTarget = null;
  if (actions) {
    actionTarget = {
      id: delivery.id,
      date: delivery.date,
      packs: delivery.packs,
      editableUntil: delivery.editableUntil,
      timezone: delivery.timezone,
      ...(hasPrice ? { price: input.subtotal } : {})
    };
  } else if (timeZone && !unavailable && (statusLocked || pastDeadline) && later[0]) {
    const followingDeadline = editableUntil(later[0].chargeAt, timeZone);
    if (!input.now || input.now.getTime() <= followingDeadline.getTime()) {
      actionTarget = {
        id: 'following',
        date: later[0].deliveryDate,
        packs: later[0].packs,
        editableUntil: followingDeadline.toISOString(),
        timezone: timeZone,
        ...(hasPrice ? { price: input.subtotal } : {})
      };
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
    contractEndIfSkip,
    offeredDates: offered
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

  assertEditable(read, deliveryId) {
    if (!read.delivery || !read.delivery.actions) {
      throw new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' });
    }
    // Only the current delivery can move its own charge; the following one waits until it is current.
    if (deliveryId && deliveryId !== read.delivery.id) {
      throw new HttpError(409, 'This delivery can no longer be changed.', { code: 'delivery_locked' });
    }
  }

  async guardMutation(subscription, userId, deliveryId) {
    const context = await this.readContext(subscription, userId);
    this.assertEditable(context.body, deliveryId);
    if (!EDITABLE_SUBSCRIPTION_STATUSES.has(String(subscription.status || ''))) {
      throw new HttpError(409, 'This subscription is not active.', { code: 'subscription_not_active' });
    }
    return context;
  }

  async skip(subscription, userId, { deliveryId } = {}) {
    const { rows, transitDays } = await this.guardMutation(subscription, userId, deliveryId);
    const plan = planSkip({
      market: subscription.market,
      rows,
      transitDays,
      chargeAt: subscription.chargeAt,
      now: this.now()
    });
    if (!plan.stripeUpdate) {
      throw new HttpError(409, 'No preparation day is available for the following delivery.', { code: 'no_preparation_day' });
    }
    return this.moveCharge(subscription, userId, plan.stripeUpdate);
  }

  async reschedule(subscription, userId, { deliveryId, date } = {}) {
    const { body } = await this.guardMutation(subscription, userId, deliveryId);
    const chosen = typeof date === 'string'
      ? body.offeredDates.find((offer) => offer.deliveryDate === date)
      : null;
    if (!chosen) {
      throw new HttpError(422, 'This date is not available for this delivery.', { code: 'date_not_allowed' });
    }
    const midnight = prepMidnight(chosen.preparationDay, timeZoneFor(subscription.market));
    return this.moveCharge(subscription, userId, {
      trial_end: Math.floor(midnight.getTime() / 1000),
      proration_behavior: 'none'
    });
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

  async commitPacks(subscription, userId, { deliveryId } = {}) {
    const { body } = await this.guardMutation(subscription, userId, deliveryId);
    return body;
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
    if (plan.stripeUpdate && client && typeof client.setTrialEnd === 'function') {
      await client.setTrialEnd({
        subscriptionId: subscription.stripeSubscriptionId,
        ...plan.stripeUpdate
      });
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
  planBlockTrialEnd
};
