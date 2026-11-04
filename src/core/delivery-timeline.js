// The four delivery stages the store shows for a UPS shipment (delivery-tracking).
const STAGES = [
  { key: 'label_created', column: 'shipped_at' },
  { key: 'in_transit', column: 'in_transit_at' },
  { key: 'out_for_delivery', column: 'out_for_delivery_at' },
  { key: 'delivered', column: 'delivered_at' }
];
const STAGE_BY_STATUS = { label_created: 0, in_transit: 1, out_for_delivery: 2, delivered: 3 };
const WARNING_STATUSES = new Set(['exception', 'returned']);

function toDate(value) {
  if (!value) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

// The current stage is the highest one reached: by a stored date, or by the last status for a stage passed
// with no scan. A warning sits on that stage and never adds one.
function deliveryTimeline(row) {
  if (!row || !['created', 'delivered'].includes(row.status)) {
    return null;
  }
  const status = String(row.tracking_status || '');
  let current = row.status === 'delivered' ? 3 : 0;
  STAGES.forEach((stage, index) => {
    if (row[stage.column]) {
      current = Math.max(current, index);
    }
  });
  if (STAGE_BY_STATUS[status] != null) {
    current = Math.max(current, STAGE_BY_STATUS[status]);
  }

  return {
    carrier: 'ups',
    current: STAGES[current].key,
    stages: STAGES.map((stage, index) => ({
      key: stage.key,
      reached: index <= current,
      at: index <= current ? toDate(row[stage.column]) : null
    })),
    description: row.tracking_description || null,
    warning: WARNING_STATUSES.has(status) ? { status, description: row.tracking_description || null } : null
  };
}

module.exports = { deliveryTimeline };
