const TRACKING_STATUS = {
  LABEL_CREATED: 'label_created',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  EXCEPTION: 'exception',
  RETURNED: 'returned',
  UNKNOWN: 'unknown'
};

const STATUS_BY_UPS_TYPE = {
  M: TRACKING_STATUS.LABEL_CREATED,
  P: TRACKING_STATUS.IN_TRANSIT,
  I: TRACKING_STATUS.IN_TRANSIT,
  X: TRACKING_STATUS.EXCEPTION
};

function upsTrackingUrl(trackingNumber) {
  const number = String(trackingNumber || '').trim();
  return number ? `https://www.ups.com/track?tracknum=${encodeURIComponent(number)}` : null;
}

function upsDateTime(date, time) {
  const day = String(date || '');
  if (!/^\d{8}$/.test(day)) {
    return null;
  }
  const clock = /^\d{6}$/.test(String(time || '')) ? String(time) : '000000';
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)} ${clock.slice(0, 2)}:${clock.slice(2, 4)}:${clock.slice(4, 6)}`;
}

function deliveredAtOf(pkg, activity) {
  const dates = Array.isArray(pkg.deliveryDate) ? pkg.deliveryDate : [];
  const delivered = dates.find((item) => item && item.type === 'DEL');
  return delivered
    ? upsDateTime(delivered.date, pkg.deliveryTime && pkg.deliveryTime.endTime)
    : upsDateTime(activity.date, activity.time);
}

// Status codes UPS uses for a box loaded on the delivery vehicle. Add a code here once the UPS catalog confirms it.
const OUT_FOR_DELIVERY_CODES = new Set(['OF']);
const OUT_FOR_DELIVERY_STATUS_CODES = new Set(['072']);
const WARNING_BY_UPS_TYPE = { X: TRACKING_STATUS.EXCEPTION, RS: TRACKING_STATUS.RETURNED };
const STAGE_KEYS = [TRACKING_STATUS.IN_TRANSIT, TRACKING_STATUS.OUT_FOR_DELIVERY, TRACKING_STATUS.DELIVERED];

function activityStatus(activity) {
  const scan = (activity && activity.status) || {};
  const type = String(scan.type || '').trim().toUpperCase();
  const code = String(scan.code || '').trim().toUpperCase();
  const statusCode = String(scan.statusCode || '').trim();
  const description = String(scan.description || '').trim();
  if (type === 'D') {
    return TRACKING_STATUS.DELIVERED;
  }
  if (WARNING_BY_UPS_TYPE[type]) {
    return WARNING_BY_UPS_TYPE[type];
  }
  if (OUT_FOR_DELIVERY_CODES.has(code) || OUT_FOR_DELIVERY_STATUS_CODES.has(statusCode) || /out for delivery/i.test(description)) {
    return TRACKING_STATUS.OUT_FOR_DELIVERY;
  }
  return STATUS_BY_UPS_TYPE[type] || null;
}

// Earliest scan first. A scan without a date keeps its place in the answer, which lists the newest first.
function scansOldestFirst(activities) {
  return activities
    .map((activity, index) => ({ activity, index, at: upsDateTime(activity && activity.date, activity && activity.time) }))
    .sort((left, right) => {
      if (left.at && right.at && left.at !== right.at) {
        return left.at < right.at ? -1 : 1;
      }
      return right.index - left.index;
    });
}

// Returns null when the answer has no package, as for a label UPS has not seen yet. `stages` holds the
// earliest scan of each carrier stage in this answer, as UPS sends the time, with no time zone.
function parseUpsTracking(payload) {
  const shipment = payload && payload.trackResponse && payload.trackResponse.shipment;
  const pkg = Array.isArray(shipment) && shipment[0] && Array.isArray(shipment[0].package)
    ? shipment[0].package[0]
    : null;
  if (!pkg) {
    return null;
  }

  const scans = scansOldestFirst(Array.isArray(pkg.activity) ? pkg.activity : []);
  const latest = scans.length ? scans[scans.length - 1].activity : {};
  const current = pkg.currentStatus || {};
  const description = String(current.description || (latest.status && latest.status.description) || '').trim().slice(0, 255);
  // SDD is the scheduled date, not a delivery.
  const hasDeliveryDate = Array.isArray(pkg.deliveryDate) && pkg.deliveryDate.some((item) => item && item.type === 'DEL');

  const stages = { in_transit: null, out_for_delivery: null, delivered: null };
  for (const { activity, at } of scans) {
    const stage = activityStatus(activity);
    if (STAGE_KEYS.includes(stage) && !stages[stage] && at) {
      stages[stage] = at;
    }
  }

  let status = activityStatus(latest) || STATUS_BY_UPS_TYPE[String(current.type || '').trim().toUpperCase()] || TRACKING_STATUS.UNKNOWN;
  if (!activityStatus(latest) && /out for delivery/i.test(description)) {
    status = TRACKING_STATUS.OUT_FOR_DELIVERY;
  }
  let deliveredAt = null;
  if (status === TRACKING_STATUS.DELIVERED || hasDeliveryDate) {
    status = TRACKING_STATUS.DELIVERED;
    deliveredAt = deliveredAtOf(pkg, latest);
    stages.delivered = deliveredAt;
  }

  return { status, description, deliveredAt, stages };
}

module.exports = {
  TRACKING_STATUS,
  parseUpsTracking,
  upsTrackingUrl
};
