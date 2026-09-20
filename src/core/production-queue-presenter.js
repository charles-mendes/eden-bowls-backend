const { DateTime } = require('luxon');
const {
  catalogFrom,
  packsPerMonth
} = require('./subscription-dashboard');
const { parseJsonColumn } = require('./stripe-subscription-map');

const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

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

function compactLineItems(items) {
  const grouped = new Map();
  for (const item of items) {
    const flavor = String(item.flavor || '').trim();
    if (!flavor) {
      continue;
    }
    const packSize = packSizeFromItem(item);
    const petName = item.petName || item.pet_name || null;
    const key = `${flavor}|${packSize}|${petName || ''}`;
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const current = grouped.get(key);
    if (current) {
      current.quantity += quantity;
    } else {
      grouped.set(key, {
        flavor,
        quantity,
        packSize,
        petName: petName ? String(petName) : null
      });
    }
  }
  return [...grouped.values()].filter((item) => item.quantity > 0);
}

function lineItemsFromPets(plan) {
  const items = [];
  for (const pet of Array.isArray(plan.pets) ? plan.pets : []) {
    const flavors = Array.isArray(pet.selected_flavors) ? pet.selected_flavors : [];
    const weights = Array.isArray(pet.flavor_weights) ? pet.flavor_weights : [];
    flavors.forEach((flavor, index) => {
      items.push({
        flavor,
        quantity: weights[index] == null ? 1 : Number(weights[index]),
        packSize: packSizeFromItem(pet),
        petName: pet.pet_name || pet.name || null
      });
    });
  }
  return compactLineItems(items);
}

function lineItemsFromCatalog(catalog) {
  const raw = Array.isArray(catalog.line_items) ? catalog.line_items : [];
  return compactLineItems(raw.map((item) => ({
    flavor: item.flavor || item.flavor_label || item.label,
    quantity: item.quantity,
    pack_size_label: item.pack_size_label,
    pack_size_grams: item.pack_size_grams,
    petName: item.pet_name || item.petName
  })));
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
  const catalogItems = lineItemsFromCatalog(catalog);
  const lineItems = catalogItems.length > 0 ? catalogItems : lineItemsFromPets(plan);
  const packSizeLabel = packSizeLabelFor(lineItems);
  const daysUntil = civilDaysUntil(row.currentPeriodEnd || row.current_period_end, timezone, now);
  const displayName = row.displayName || row.display_name || row.customerEmail || row.customer_email || '';
  const periodEnd = toJsDate(row.currentPeriodEnd || row.current_period_end);
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
    note: row.note || row.production_note || null,
    subtotal,
    currency: catalog.currency || (country === 'BR' ? 'BRL' : null),
    stripeAccount: String(row.stripeAccount || row.stripe_account || 'us').toLowerCase() || 'us',
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
