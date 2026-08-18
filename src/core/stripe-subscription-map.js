function parseJsonColumn(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return null;
  }
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'number') {
    const millis = value < 1e12 ? value * 1000 : value;
    const fromUnix = new Date(millis);
    return Number.isNaN(fromUnix.getTime()) ? null : fromUnix.toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toMysqlDateTime(value) {
  const iso = toIsoDate(value);
  return iso ? iso.slice(0, 19).replace('T', ' ') : null;
}

function fromStripeUnix(seconds) {
  const numeric = Number(seconds);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }

  return toMysqlDateTime(numeric);
}

function extractSubscriptionPeriod(subscription = {}) {
  const item = Array.isArray(subscription.items && subscription.items.data)
    ? subscription.items.data[0]
    : null;

  return {
    start: subscription.current_period_start || (item && item.current_period_start) || null,
    end: subscription.current_period_end || (item && item.current_period_end) || null
  };
}

function mapStripeStatus(subscription = {}) {
  if (subscription.pause_collection) {
    return 'paused';
  }

  const status = String(subscription.status || '');
  if (status === 'canceled' || status === 'incomplete_expired') {
    return 'canceled';
  }
  if (status === 'past_due' || status === 'unpaid') {
    return 'past_due';
  }
  if (['active', 'trialing', 'incomplete', 'paused'].includes(status)) {
    return status;
  }

  return status || 'incomplete';
}

function extractSubscriptionIdFromInvoice(invoice = {}) {
  if (typeof invoice.subscription === 'string' && invoice.subscription.startsWith('sub_')) {
    return invoice.subscription;
  }

  if (invoice.subscription && typeof invoice.subscription === 'object' && invoice.subscription.id) {
    return String(invoice.subscription.id);
  }

  const parent = invoice.parent && invoice.parent.subscription_details
    ? invoice.parent.subscription_details
    : null;
  if (parent && typeof parent.subscription === 'string' && parent.subscription.startsWith('sub_')) {
    return parent.subscription;
  }
  if (parent && parent.subscription && parent.subscription.id) {
    return String(parent.subscription.id);
  }

  return '';
}

function extractCardFromPaymentMethod(paymentMethod) {
  const card = paymentMethod && paymentMethod.card ? paymentMethod.card : {};
  return {
    last4: card.last4 ? String(card.last4) : '',
    brand: card.brand ? String(card.brand) : ''
  };
}

function formatDeliveryAddress(address) {
  if (!address || typeof address !== 'object') {
    return null;
  }

  const parts = [
    address.street || address.line1 || address.address_line1 || address.address,
    address.number,
    address.city,
    address.state,
    address.zipcode || address.postal_code || address.postalCode
  ].map((part) => String(part || '').trim()).filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

function planLabelFromLedger(row, index = 0) {
  const label = String(row && (row.planLabel || row.plan_label) || '').trim();
  if (label) {
    return label;
  }

  const id = Number(row && row.id) || index + 1;
  return `Plan #${id}`;
}

function buildPetsSnapshot(planSelection = {}, contextPets = []) {
  const pets = Array.isArray(planSelection.pets) ? planSelection.pets : [];
  const mapped = pets.map((pet) => ({
    id: String(pet.pet_id || pet.id || ''),
    name: String(pet.pet_name || pet.name || '')
  })).filter((pet) => pet.id || pet.name);

  const fromContext = Array.isArray(contextPets)
    ? contextPets.map((pet) => ({
      id: String(pet.id || pet.pet_id || ''),
      name: String(pet.name || pet.pet_name || '')
    })).filter((pet) => pet.id || pet.name)
    : [];

  const resolved = mapped.length > 0 ? mapped : fromContext;

  return {
    pet_ids: resolved.map((pet) => pet.id).filter(Boolean),
    pets_names: resolved.map((pet) => pet.name).filter(Boolean),
    pets: resolved
  };
}

module.exports = {
  parseJsonColumn,
  toIsoDate,
  toMysqlDateTime,
  fromStripeUnix,
  extractSubscriptionPeriod,
  mapStripeStatus,
  extractSubscriptionIdFromInvoice,
  extractCardFromPaymentMethod,
  formatDeliveryAddress,
  planLabelFromLedger,
  buildPetsSnapshot
};
