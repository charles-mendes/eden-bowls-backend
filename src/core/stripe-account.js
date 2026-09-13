const { HttpError } = require('./http-error');

const STRIPE_ACCOUNTS = {
  BR: 'br',
  US: 'us'
};

const DEFAULT_STRIPE_API_VERSION = '2025-09-30.clover';

const CUSTOMER_META_KEYS = {
  br: '_hsr_stripe_customer_id_br',
  us: '_hsr_stripe_customer_id_us'
};

const LEGACY_CUSTOMER_META_KEY = '_hsr_stripe_customer_id';

function normalizeStripeAccount(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === STRIPE_ACCOUNTS.BR || normalized === STRIPE_ACCOUNTS.US) {
    return normalized;
  }
  throw new HttpError(400, 'Invalid Stripe account.', { code: 'invalid_stripe_account' });
}

function parseStripeAccountInput(value, fallback = STRIPE_ACCOUNTS.US) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return fallback;
  }
  return normalizeStripeAccount(value);
}

function resolveStripeAccountFromCountry(country) {
  const normalized = String(country || '').trim().toUpperCase();
  if (normalized === 'BR') {
    return STRIPE_ACCOUNTS.BR;
  }
  if (normalized === 'US') {
    return STRIPE_ACCOUNTS.US;
  }
  throw new HttpError(400, 'Stripe checkout requires a BR or US address.', {
    code: 'invalid_stripe_country'
  });
}

function stripeAccountFromMarket(market) {
  const country = market && typeof market === 'object' ? market.country : market;
  return resolveStripeAccountFromCountry(country);
}

function customerMetaKey(account) {
  return CUSTOMER_META_KEYS[normalizeStripeAccount(account)];
}

function ledgerStripeAccount(row) {
  const raw = row && (row.stripeAccount || row.stripe_account);
  if (!raw) {
    return STRIPE_ACCOUNTS.US;
  }
  try {
    return normalizeStripeAccount(raw);
  } catch {
    return STRIPE_ACCOUNTS.US;
  }
}

module.exports = {
  STRIPE_ACCOUNTS,
  DEFAULT_STRIPE_API_VERSION,
  CUSTOMER_META_KEYS,
  LEGACY_CUSTOMER_META_KEY,
  normalizeStripeAccount,
  parseStripeAccountInput,
  resolveStripeAccountFromCountry,
  stripeAccountFromMarket,
  customerMetaKey,
  ledgerStripeAccount
};
