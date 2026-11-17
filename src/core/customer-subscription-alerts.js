const { dateKey, timeZoneFor, zonedParts } = require('./delivery-closed-days');

const DAY_MS = 24 * 60 * 60 * 1000;
const NFE_PROBLEM = new Set(['rejected', 'error', 'blocked_missing_document']);
const NFE_WAITING = new Set(['pending', 'submitted']);

function hasContent(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.values(value).some((entry) => entry !== null && entry !== undefined);
}

function marketOf(stripeAccount) {
  return String(stripeAccount || '').toLowerCase() === 'br' ? 'BR' : 'US';
}

// The calendar day of `now` in the subscription's market, as YYYY-MM-DD.
function marketToday(now, stripeAccount) {
  const parts = zonedParts(now, timeZoneFor(marketOf(stripeAccount)));
  return dateKey(parts.year, parts.month, parts.day);
}

function nfeAlerts(item, cycle, now) {
  // The nfe key exists only for a Brazil subscription read by someone with nfe.read.
  if (!Object.prototype.hasOwnProperty.call(cycle, 'nfe')) return [];
  const note = cycle.nfe;
  if (note && NFE_PROBLEM.has(note.status)) {
    return [{ code: 'nfe_problem', nfeId: note.id, status: note.status, lastError: note.lastError || null }];
  }
  if (!note || NFE_WAITING.has(note.status)) {
    const paid = cycle.paidAt ? Date.parse(cycle.paidAt) : NaN;
    if (Number.isFinite(paid) && now.getTime() - paid >= DAY_MS) {
      return [{ code: 'nfe_missing', status: note ? note.status : null, paidAt: cycle.paidAt }];
    }
  }
  return [];
}

function deliveryFailedAlert(cycle) {
  const delivery = cycle.delivery;
  if (!delivery || delivery.kind !== 'courier' || delivery.status !== 'failed') return [];
  return [{ code: 'delivery_failed', courierDeliveryId: delivery.id, failedAt: delivery.failedAt || null }];
}

function readyNotDispatchedAlert(item, cycle, now) {
  // Both keys exist only for an actor with production.read and shipping.read.
  if (!cycle.production || !Object.prototype.hasOwnProperty.call(cycle, 'delivery')) return [];
  if (cycle.production.status !== 'ready' || cycle.delivery !== null || !cycle.deliveryDate) return [];
  if (String(cycle.deliveryDate).slice(0, 10) > marketToday(now, item.stripeAccount)) return [];
  return [{ code: 'ready_not_dispatched', deliveryDate: cycle.deliveryDate }];
}

function pendingChangeAlert(row) {
  const kinds = [];
  if (hasContent(row.editPending)) kinds.push('edit');
  if (hasContent(row.pendingDeliveryChanges)) kinds.push('delivery');
  return kinds.length ? [{ code: 'pending_change', kinds }] : [];
}

// The operational alerts of one customer subscription (admin-customer-subscriptions). Read only from the item the
// actor already sees, so a block hidden by permission never raises an alert. No storage, Stripe or Bling.
function subscriptionAlerts({ item, row, now = new Date() }) {
  const cycle = item.latestCycleUnavailable ? null : item.latestCycle;
  const alerts = cycle ? [
    ...nfeAlerts(item, cycle, now),
    ...deliveryFailedAlert(cycle),
    ...readyNotDispatchedAlert(item, cycle, now)
  ] : [];
  return [...alerts, ...pendingChangeAlert(row || {})];
}

module.exports = { subscriptionAlerts };
