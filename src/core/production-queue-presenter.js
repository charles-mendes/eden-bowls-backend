const { DateTime } = require('luxon');
const {
  catalogFrom,
  packsPerMonth
} = require('./subscription-dashboard');
const { parseJsonColumn } = require('./stripe-subscription-map');
const { canAccessMarket } = require('./admin-market-scope');
const { parseWeightToGrams } = require('./plan-catalog-pricing');

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

const PAYMENT_LABELS = {
  awaiting_payment: 'Aguardando pagamento',
  past_due: 'Pagamento atrasado'
};

function jsonColumn(value) {
  return parseJsonColumn(value) || {};
}

function toJsDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function civilDaysUntil(periodEnd, timezone = DEFAULT_TIMEZONE, now = new Date()) {
  const due = toJsDate(periodEnd);
  if (!due) {
    return null;
  }
  const zone = timezone || DEFAULT_TIMEZONE;
  const today = DateTime.fromJSDate(now, { zone }).startOf('day');
  const dueDay = DateTime.fromJSDate(due, { zone }).startOf('day');
  return Math.round(dueDay.diff(today, 'days').days);
}

function dueBucket(daysUntil) {
  if (daysUntil == null) {
    return null;
  }
  if (daysUntil < 0) {
    return 'overdue';
  }
  if (daysUntil === 0) {
    return 'today';
  }
  if (daysUntil === 1) {
    return 'tomorrow';
  }
  return 'upcoming';
}

function dueLabel(daysUntil) {
  if (daysUntil == null) {
    return '';
  }
  if (daysUntil === 0) {
    return 'Vence hoje';
  }
  if (daysUntil === 1) {
    return 'Amanhã';
  }
  if (daysUntil > 1) {
    return `Faltam ${daysUntil} dias`;
  }
  return `Atrasado ${Math.abs(daysUntil)} dias`;
}

function packSizeFromItem(item) {
  if (item && item.pack_size_label) {
    return String(item.pack_size_label);
  }
  if (item && item.packSize) {
    return String(item.packSize);
  }
  const grams = Number(item && (item.pack_size_grams || item.packSizeGrams));
  if (Number.isFinite(grams) && grams > 0) {
    return `${Math.round(grams)} g`;
  }
  return '';
}

// Whole grams of a line, rounded like the catalog does: the stored grams, else the size read from its label.
function packSizeGramsFromItem(item) {
  const grams = Number(item && (item.pack_size_grams || item.packSizeGrams));
  if (Number.isFinite(grams) && grams > 0) {
    return Math.round(grams);
  }
  const fromLabel = parseWeightToGrams(packSizeFromItem(item));
  return fromLabel > 0 ? Math.round(fromLabel) : null;
}

// The queue shows the catalog short name, then the full name, and the key only when no name exists.
function displayFlavor(flavorKey, label, names) {
  const catalog = names && names[flavorKey];
  return (catalog && catalog.shortLabel) || label || (catalog && catalog.label) || flavorKey;
}

function compactLineItems(items, names) {
  const grouped = new Map();
  for (const item of items) {
    const label = String(item.label || '').trim();
    const flavorKey = String(item.flavor || '').trim() || label;
    if (!flavorKey) {
      continue;
    }
    const packSize = packSizeFromItem(item);
    const petName = item.petName || item.pet_name || null;
    const key = `${flavorKey}|${packSize}|${petName || ''}`;
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const current = grouped.get(key);
    if (current) {
      current.quantity += quantity;
    } else {
      grouped.set(key, {
        flavor: displayFlavor(flavorKey, label, names),
        flavorKey,
        quantity,
        packSize,
        packSizeGrams: packSizeGramsFromItem(item),
        petName: petName ? String(petName) : null
      });
    }
  }
  return [...grouped.values()].filter((item) => item.quantity > 0);
}

function lineItemsFromPets(plan, names) {
  const items = [];
  for (const pet of Array.isArray(plan.pets) ? plan.pets : []) {
    const flavors = Array.isArray(pet.selected_flavors) ? pet.selected_flavors : [];
    const weights = Array.isArray(pet.flavor_weights) ? pet.flavor_weights : [];
    flavors.forEach((flavor, index) => {
      items.push({
        flavor,
        quantity: weights[index] == null ? 1 : Number(weights[index]),
        packSize: packSizeFromItem(pet),
        pack_size_grams: pet.pack_size_grams,
        petName: pet.pet_name || pet.name || null
      });
    });
  }
  return compactLineItems(items, names);
}

function lineItemsFromCatalog(catalog, names) {
  const raw = Array.isArray(catalog.line_items) ? catalog.line_items : [];
  return compactLineItems(raw.map((item) => ({
    flavor: item.flavor,
    label: item.flavor_label || item.label,
    quantity: item.quantity,
    pack_size_label: item.pack_size_label,
    pack_size_grams: item.pack_size_grams,
    petName: item.pet_name || item.petName
  })), names);
}

function packSizeLabelFor(lineItems) {
  const sizes = [...new Set(lineItems.map((item) => item.packSize).filter(Boolean))];
  if (sizes.length === 0) {
    return '';
  }
  if (sizes.length > 1) {
    return 'misto';
  }
  return sizes[0];
}

function flavorMixFor(lineItems) {
  return lineItems.map((item) => `${item.flavor} × ${item.quantity}`).join(', ');
}

function addressBits(row) {
  const address = jsonColumn(row.address);
  return {
    country: address.country ? String(address.country).toUpperCase() : '',
    city: address.city ? String(address.city) : ''
  };
}

function presentProductionQueueItem(row, options = {}) {
  const timezone = options.timezone || DEFAULT_TIMEZONE;
  const now = options.now || new Date();
  const plan = jsonColumn(row.planSelection || row.plan_selection);
  const catalog = catalogFrom(row);
  const stripeAccount = String(row.stripeAccount || row.stripe_account || 'us').toLowerCase() || 'us';
  const names = options.recipeNames ? options.recipeNames[stripeAccount === 'br' ? 'BR' : 'US'] : null;
  const catalogItems = lineItemsFromCatalog(catalog, names);
  const lineItems = catalogItems.length > 0 ? catalogItems : lineItemsFromPets(plan, names);
  const packSizeLabel = packSizeLabelFor(lineItems);
  // A paid cycle is due on its preparation day; an unpaid one on its charge.
  const daysUntil = civilDaysUntil(row.dueAt || row.currentPeriodEnd || row.current_period_end, timezone, now);
  const address = jsonColumn(row.address);
  const displayName = address.name || address.full_name || address.recipient
    || row.customerEmail || row.customer_email || '';
  // The cycle key the admin sends back when it changes the production status.
  const periodEnd = toJsDate(row.cyclePeriodEnd || row.currentPeriodEnd || row.current_period_end);
  const { country, city } = addressBits(row);
  const subtotal = Number.isFinite(Number(catalog.subtotal)) ? Number(catalog.subtotal) : null;
  const productionStatus = String(row.productionStatus || row.production_status || 'to_prepare');
  const summedPacks = lineItems.reduce((sum, item) => sum + item.quantity, 0);
  const packCount = summedPacks > 0 ? summedPacks : (packsPerMonth(catalog, plan) || 0);

  return {
    id: Number(row.id),
    userId: String(row.userId || row.user_id || ''),
    stripeSubscriptionId: String(row.stripeSubscriptionId || row.stripe_subscription_id || ''),
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    daysUntil,
    dueBucket: dueBucket(daysUntil),
    dueLabel: dueLabel(daysUntil),
    displayName: String(displayName),
    email: String(row.customerEmail || row.customer_email || ''),
    flavorMix: flavorMixFor(lineItems),
    packCount,
    packSizeLabel,
    planLabel: row.planLabel || row.plan_label || null,
    termMonths: row.subscriptionTermMonths == null && row.subscription_term_months == null
      ? (plan.subscription_term_months == null ? null : Number(plan.subscription_term_months))
      : Number(row.subscriptionTermMonths || row.subscription_term_months),
    country,
    city,
    stripeStatus: String(row.status || row.stripeStatus || ''),
    productionStatus,
    paymentState: String(row.paymentState || 'paid'),
    paymentLabel: PAYMENT_LABELS[row.paymentState] || null,
    preparationDay: row.preparationDay || null,
    deliveryDate: row.deliveryDate || null,
    note: row.note || row.production_note || null,
    subtotal,
    currency: catalog.currency || (country === 'BR' ? 'BRL' : null),
    stripeAccount,
    customerProfileInScope: canAccessMarket(options.actor || {}, row.profileMarket || row.profile_market),
    dense: lineItems.length > 3 || packSizeLabel === 'misto',
    lineItems
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  civilDaysUntil,
  dueBucket,
  dueLabel,
  presentProductionQueueItem
};
