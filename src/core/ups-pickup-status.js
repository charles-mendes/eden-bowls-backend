// A pickup reserved but never moved past `pending` (the process stopped between the reservation and the UPS
// answer) is treated as `unknown` after this long, so its labels can be freed (ups-pickup).
const STALE_PENDING_MS = 5 * 60 * 1000;

function isStalePending(pickup, now = new Date()) {
  if (!pickup || pickup.status !== 'pending' || !pickup.created_at) return false;
  const created = new Date(pickup.created_at).getTime();
  return Number.isFinite(created) && now.getTime() - created >= STALE_PENDING_MS;
}

function effectivePickupStatus(pickup, now = new Date()) {
  if (!pickup) return null;
  return isStalePending(pickup, now) ? 'unknown' : pickup.status;
}

module.exports = { STALE_PENDING_MS, effectivePickupStatus, isStalePending };
