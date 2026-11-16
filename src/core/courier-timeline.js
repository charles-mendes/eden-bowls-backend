// The three delivery stages the store shows for a Brazil courier delivery (courier-delivery).
// Same shape as deliveryTimeline, so the store only adds the stage keys.
const STAGES = ['preparing', 'out_for_delivery', 'delivered'];
const ACTIVE = new Set(['out_for_delivery', 'delivered']);

function toDate(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function byNewest(a, b) {
  return Number(b.id || 0) - Number(a.id || 0);
}

// The attempt that holds the invoice: out for delivery or delivered. At most one exists (unique index).
function activeCourierDelivery(rows = []) {
  return (rows || []).filter((row) => row && ACTIVE.has(row.status)).sort(byNewest)[0] || null;
}

// Preparing is reached once the invoice is paid. A failure with no new attempt is a warning on preparing;
// a canceled attempt never shows.
function courierTimeline(rows = [], { paidAt = null } = {}) {
  const active = activeCourierDelivery(rows);
  const failed = active ? null : (rows || []).filter((row) => row && row.status === 'failed').sort(byNewest)[0] || null;
  const dates = {
    preparing: toDate(paidAt),
    out_for_delivery: active ? toDate(active.out_for_delivery_at) : null,
    delivered: active && active.status === 'delivered' ? toDate(active.delivered_at) : null
  };
  let current = 0;
  if (active) current = active.status === 'delivered' ? 2 : 1;

  return {
    carrier: 'courier',
    current: STAGES[current],
    stages: STAGES.map((key, index) => ({ key, reached: index <= current, at: index <= current ? dates[key] : null })),
    description: null,
    warning: failed ? { status: 'failed', description: null } : null
  };
}

module.exports = { activeCourierDelivery, courierTimeline };
