const { parseJsonColumn } = require('../stripe-subscription-map');

function firstNameFrom(source = {}) {
  const address = source.address || {};
  const full = String(
    address.name
    || address.full_name
    || address.recipient
    || source.customerName
    || ''
  ).trim();
  return full.split(/\s+/)[0] || '';
}

function petNameFrom(source = {}) {
  const snapshot = parseJsonColumn(source.petsSnapshot || source.pets_snapshot) || {};
  if (Array.isArray(snapshot.pets_names) && snapshot.pets_names[0]) {
    return String(snapshot.pets_names[0]);
  }
  const snapshotPets = Array.isArray(snapshot.pets) ? snapshot.pets : [];
  if (snapshotPets[0]) {
    return String(snapshotPets[0].name || snapshotPets[0].pet_name || '');
  }
  const plan = parseJsonColumn(source.planSelection || source.plan_selection) || {};
  const planPets = Array.isArray(plan.pets) ? plan.pets : [];
  if (planPets[0]) {
    return String(planPets[0].pet_name || planPets[0].name || '');
  }
  return '';
}

function flavorsFrom(source = {}) {
  const plan = parseJsonColumn(source.planSelection || source.plan_selection) || {};
  const pets = Array.isArray(plan.pets) ? plan.pets : [];
  const labels = [];
  for (const pet of pets) {
    for (const flavor of Array.isArray(pet.selected_flavors) ? pet.selected_flavors : []) {
      const label = typeof flavor === 'string'
        ? flavor
        : (flavor && (flavor.label || flavor.key || flavor.name)) || '';
      if (label && !labels.includes(label)) {
        labels.push(String(label));
      }
    }
  }
  return labels;
}

function localeFrom(source = {}) {
  const account = String(source.stripeAccount || source.stripe_account || '').toLowerCase();
  const country = String(
    (source.address && source.address.country)
    || (source.term && source.term.marketCountry)
    || ''
  ).toUpperCase();
  if (account === 'br' || country === 'BR') {
    return 'pt-BR';
  }
  return 'en-US';
}

function formatMoney(amountMinor, currency) {
  const amount = Number(amountMinor || 0) / 100;
  if (!Number.isFinite(amount)) {
    return '';
  }
  const code = String(currency || 'usd').toLowerCase();
  if (code === 'brl') {
    return `R$ ${amount.toFixed(2).replace('.', ',')}`;
  }
  return `$${amount.toFixed(2)}`;
}

function dashboardPlansUrl(storeAppUrl) {
  const base = String(storeAppUrl || 'http://localhost:5173').replace(/\/+$/, '');
  return `${base}/dashboard/plans`;
}

function joinPath(base, path) {
  const root = String(base || '').replace(/\/+$/, '');
  const suffix = String(path || '').replace(/^\/+/, '');
  if (!root) {
    return `/${suffix}`;
  }
  return suffix ? `${root}/${suffix}` : root;
}

module.exports = {
  dashboardPlansUrl,
  firstNameFrom,
  flavorsFrom,
  formatMoney,
  joinPath,
  localeFrom,
  petNameFrom
};
