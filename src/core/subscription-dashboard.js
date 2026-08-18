const {
  parseJsonColumn,
  toIsoDate,
  formatDeliveryAddress,
  planLabelFromLedger
} = require('./stripe-subscription-map');

function readPets(row) {
  const snapshot = parseJsonColumn(row.petsSnapshot || row.pets_snapshot) || {};
  const plan = parseJsonColumn(row.planSelection || row.plan_selection) || {};
  const pets = Array.isArray(snapshot.pets) && snapshot.pets.length > 0
    ? snapshot.pets
    : (Array.isArray(plan.pets) ? plan.pets.map((pet) => ({
      id: String(pet.pet_id || pet.id || ''),
      name: String(pet.pet_name || pet.name || '')
    })) : []);

  return {
    pets,
    pet_ids: Array.isArray(snapshot.pet_ids) && snapshot.pet_ids.length > 0
      ? snapshot.pet_ids.map(String)
      : pets.map((pet) => String(pet.id || pet.pet_id || '')).filter(Boolean),
    pets_names: Array.isArray(snapshot.pets_names) && snapshot.pets_names.length > 0
      ? snapshot.pets_names.map(String)
      : pets.map((pet) => String(pet.name || pet.pet_name || '')).filter(Boolean)
  };
}

function catalogFrom(row) {
  const plan = parseJsonColumn(row.planSelection || row.plan_selection) || {};
  return plan.catalog_pricing && typeof plan.catalog_pricing === 'object'
    ? plan.catalog_pricing
    : {};
}

function nextShipment(row) {
  const plan = parseJsonColumn(row.planSelection || row.plan_selection) || {};
  const shipping = parseJsonColumn(row.shipping) || {};
  const date = toIsoDate(plan.next_shipment_date || shipping.next_shipment_date);
  const window = shipping.shipping_window || plan.shipping_window || (shipping.label ? 'weekly' : null);

  return {
    next_shipment_date: date,
    next_shipment_source: date ? 'plan_selection' : null,
    next_shipment_context: window ? { shipping_window: window } : {}
  };
}

function activeFlavors(row) {
  const plan = parseJsonColumn(row.planSelection || row.plan_selection) || {};
  const flavors = [];
  for (const pet of Array.isArray(plan.pets) ? plan.pets : []) {
    for (const flavor of Array.isArray(pet.selected_flavors) ? pet.selected_flavors : []) {
      if (flavor && !flavors.includes(flavor)) {
        flavors.push(String(flavor));
      }
    }
  }
  return flavors;
}

function planItemsFromCatalog(catalog) {
  return (Array.isArray(catalog.line_items) ? catalog.line_items : []).map((item) => ({
    label: item.pet_name ? `${item.pet_name} — ${item.flavor || ''}`.trim() : (item.flavor || item.label || ''),
    flavor: item.flavor || null,
    quantity: item.quantity == null ? null : Number(item.quantity),
    unit_amount: item.unit_price == null ? null : Number(item.unit_price),
    line_total: item.line_total == null ? null : Number(item.line_total),
    currency: item.currency || catalog.currency || null,
    stripe_price_id: item.stripe_price_id || item.price_id || null,
    source: 'plan_selection'
  }));
}

function packsPerMonth(catalog, plan) {
  if (Number.isFinite(Number(plan && plan.packs_per_month))) {
    return Number(plan.packs_per_month);
  }

  const items = Array.isArray(catalog.line_items) ? catalog.line_items : [];
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity) || 0), 0);
  return total > 0 ? total : null;
}

function mapLedgerToDashboardListItem(row, index = 0) {
  const pets = readPets(row);
  const plan = parseJsonColumn(row.planSelection || row.plan_selection) || {};
  const catalog = catalogFrom(row);
  const shipment = nextShipment(row);
  const status = String(row.status || 'incomplete');
  const subId = String(row.stripeSubscriptionId || row.stripe_subscription_id || '');
  const label = planLabelFromLedger(row, index);
  const periodEnd = toIsoDate(row.currentPeriodEnd || row.current_period_end);

  return {
    subscription_id: subId,
    stripe_subscription_id: subId,
    legacy_subscription_id: null,
    slug: subId,
    plan_label: label,
    status,
    stripe_subscription_status: status,
    contract_label: label,
    start_date: toIsoDate(row.createdAt || row.created_at || row.currentPeriodStart || row.current_period_start),
    end_date: status === 'canceled' ? periodEnd : null,
    end_date_source: status === 'canceled' ? 'stripe' : null,
    current_period_start: toIsoDate(row.currentPeriodStart || row.current_period_start),
    current_period_end: periodEnd,
    next_billing_date: periodEnd,
    next_billing_source: periodEnd ? 'stripe' : null,
    next_shipment_date: shipment.next_shipment_date,
    next_shipment_source: shipment.next_shipment_source,
    next_shipment_context: shipment.next_shipment_context,
    pets_names: pets.pets_names,
    pet_ids: pets.pet_ids,
    packs_per_month: packsPerMonth(catalog, plan),
    order_total_per_month: Number.isFinite(Number(catalog.subtotal)) ? Number(catalog.subtotal) : (
      Number.isFinite(Number(catalog.grand_total)) ? Number(catalog.grand_total) : null
    )
  };
}

function mapLedgerToDashboardDetail(row, extras = {}) {
  const list = mapLedgerToDashboardListItem(row);
  const pets = readPets(row);
  const plan = parseJsonColumn(row.planSelection || row.plan_selection) || {};
  const catalog = catalogFrom(row);
  const address = parseJsonColumn(row.address) || {};
  const term = Number(row.subscriptionTermMonths || row.subscription_term_months || plan.subscription_term_months || 0) || null;
  const cancelAtPeriodEnd = Boolean(Number(row.cancelAtPeriodEnd == null ? row.cancel_at_period_end : row.cancelAtPeriodEnd));
  const editPending = Boolean(Number(row.editPaymentPending == null ? row.edit_payment_pending : row.editPaymentPending));

  return {
    ...list,
    pets: pets.pets,
    packs_per_delivery: list.packs_per_month,
    frequency: term === 1 || !term ? 'monthly' : `${term}_month`,
    active_flavors: activeFlavors(row),
    price_per_cycle: list.order_total_per_month,
    cycle_unit: 'month',
    payment_method_brand: extras.paymentMethodBrand || row.paymentMethodBrand || row.payment_method_brand || null,
    payment_method_last4: extras.paymentMethodLast4 || row.paymentMethodLast4 || row.payment_method_last4 || null,
    delivery_address: formatDeliveryAddress(address),
    auto_renew: !cancelAtPeriodEnd,
    current_cycle: extras.currentCycle == null ? 1 : extras.currentCycle,
    total_cycles: term,
    billing_history: Array.isArray(extras.billingHistory) ? extras.billingHistory : [],
    plan_items: planItemsFromCatalog(catalog),
    plan_items_source: 'plan_selection',
    stripe_timeline: Array.isArray(extras.stripeTimeline) ? extras.stripeTimeline : [],
    edit_payment_pending: editPending,
    subscription_term_months: term
  };
}

function mapLedgerToActionSummary(row) {
  const detail = mapLedgerToDashboardDetail(row);
  return {
    id: detail.subscription_id,
    subscription_id: detail.subscription_id,
    status: detail.status,
    plan_label: detail.plan_label,
    current_period_end: detail.current_period_end,
    ...detail
  };
}

module.exports = {
  mapLedgerToDashboardListItem,
  mapLedgerToDashboardDetail,
  mapLedgerToActionSummary
};
