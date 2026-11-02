const TRACKING_STATUS = {
  LABEL_CREATED: 'label_created',
  IN_TRANSIT: 'in_transit',
  OUT_FOR_DELIVERY: 'out_for_delivery',
  DELIVERED: 'delivered',
  EXCEPTION: 'exception',
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

// The newest scan comes first. Returns null when the answer has no package, as for a label UPS has not seen yet.
function parseUpsTracking(payload) {
  const shipment = payload && payload.trackResponse && payload.trackResponse.shipment;
  const pkg = Array.isArray(shipment) && shipment[0] && Array.isArray(shipment[0].package)
    ? shipment[0].package[0]
    : null;
  if (!pkg) {
    return null;
  }

  const activity = (Array.isArray(pkg.activity) && pkg.activity[0]) || {};
  const scan = activity.status || {};
  const current = pkg.currentStatus || {};
  const description = String(current.description || scan.description || '').trim().slice(0, 255);
  const type = String(scan.type || current.type || '').trim().toUpperCase();
  const hasDeliveryDate = Array.isArray(pkg.deliveryDate) && pkg.deliveryDate.some((item) => item && item.type === 'DEL');

  if (type === 'D' || hasDeliveryDate) {
    return { status: TRACKING_STATUS.DELIVERED, description, deliveredAt: deliveredAtOf(pkg, activity) };
  }
  if (/out for delivery/i.test(description)) {
    return { status: TRACKING_STATUS.OUT_FOR_DELIVERY, description, deliveredAt: null };
  }
  return { status: STATUS_BY_UPS_TYPE[type] || TRACKING_STATUS.UNKNOWN, description, deliveredAt: null };
}

module.exports = {
  TRACKING_STATUS,
  parseUpsTracking,
  upsTrackingUrl
};
