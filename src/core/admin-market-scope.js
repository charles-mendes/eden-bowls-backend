const { HttpError } = require('./http-error');
const { STRIPE_ACCOUNTS, stripeAccountFromMarket } = require('./stripe-account');

const ADMIN_MARKETS_META_KEY = '_eden_admin_markets';
const PROFILE_MARKET_META_KEY = 'hsr_market_country';
const VALID_MARKETS = ['BR', 'US'];
const MARKET_PERMISSIONS = {
  BR: 'market.br',
  US: 'market.us'
};

function unique(values) {
  return [...new Set(values)];
}

function toBooleanFlag(value) {
  if (value === undefined || value === null || value === '') {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseMarkets(value) {
  const collected = [];

  const pushToken = (token) => {
    const normalized = normalizeMarketToken(token);
    if (normalized) {
      collected.push(normalized);
    }
  };

  if (Array.isArray(value)) {
    value.forEach(pushToken);
    return orderMarkets(unique(collected));
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parseMarkets(parsed);
    }
  } catch (_error) {
    // stored as a single market or comma-separated list
  }

  raw.split(/[,\s]+/).forEach(pushToken);
  return orderMarkets(unique(collected));
}

function normalizeMarketToken(value) {
  if (value == null || value === '') {
    return '';
  }

  const raw = String(value).trim();
  const upper = raw.toUpperCase();
  if (upper === 'BR' || upper === 'US') {
    return upper;
  }

  const lower = raw.toLowerCase();
  if (lower === STRIPE_ACCOUNTS.BR) {
    return 'BR';
  }
  if (lower === STRIPE_ACCOUNTS.US) {
    return 'US';
  }

  return '';
}

function orderMarkets(markets) {
  return VALID_MARKETS.filter((market) => markets.includes(market));
}

function resolveStaffMarkets({ roles = [], storedMarkets } = {}) {
  if (Array.isArray(roles) && roles.includes('admin')) {
    return [...VALID_MARKETS];
  }

  return parseMarkets(storedMarkets);
}

function marketPermissions(markets = []) {
  return orderMarkets(markets).map((market) => MARKET_PERMISSIONS[market]);
}

function marketsFromIdentity(identity) {
  if (!identity) {
    return [];
  }

  if (Array.isArray(identity.markets)) {
    return orderMarkets(identity.markets);
  }

  return resolveStaffMarkets({
    roles: identity.roles,
    storedMarkets: identity.storedMarkets
  });
}

function isStaffMarketEnforced(env = process.env) {
  return toBooleanFlag(env && env.ADMIN_ENFORCE_STAFF_MARKET);
}

function isAdminIdentity(identity) {
  return Boolean(identity && Array.isArray(identity.roles) && identity.roles.includes('admin'));
}

function effectiveMarkets(identity, env = process.env) {
  if (isAdminIdentity(identity)) {
    return [...VALID_MARKETS];
  }

  const assigned = marketsFromIdentity(identity);
  if (assigned.length > 0) {
    return assigned;
  }

  if (isStaffMarketEnforced(env)) {
    throw new HttpError(403, 'Staff market assignment is required.', { code: 'market_required' });
  }

  return [...VALID_MARKETS];
}

function stripeAccountForMarkets(markets = []) {
  return orderMarkets(markets).map((market) => stripeAccountFromMarket(market));
}

function requestedMarketsFromQuery(query = {}) {
  const values = [query.market, query.country, query.account, query.stripe_account];
  const requested = [];

  for (const value of values) {
    if (value == null || String(value).trim() === '') {
      continue;
    }

    const normalized = normalizeMarketToken(value);
    if (!normalized) {
      throw new HttpError(403, 'Requested market is outside staff scope.', { code: 'market_forbidden' });
    }

    requested.push(normalized);
  }

  return unique(requested);
}

function constrainMarketQuery(identity, query = {}, env = process.env) {
  const allowed = effectiveMarkets(identity, env);
  const requested = requestedMarketsFromQuery(query);

  for (const market of requested) {
    if (!allowed.includes(market)) {
      throw new HttpError(403, 'Requested market is outside staff scope.', { code: 'market_forbidden' });
    }
  }

  const markets = requested.length > 0 ? orderMarkets(requested) : allowed;
  const stripeAccounts = stripeAccountForMarkets(markets);

  return {
    markets,
    market: markets.length === 1 ? markets[0] : '',
    stripeAccounts,
    stripeAccount: stripeAccounts.length === 1 ? stripeAccounts[0] : '',
    filtered: requested.length > 0
  };
}

function appendInFilter(where, params, columnSql, values) {
  if (!Array.isArray(values) || values.length === 0) {
    where.push('1=0');
    return;
  }

  if (values.length === 1) {
    where.push(`${columnSql} = ?`);
    params.push(values[0]);
    return;
  }

  where.push(`${columnSql} IN (${values.map(() => '?').join(', ')})`);
  params.push(...values);
}

function appendCustomerMarketFilter(where, params, options = {}) {
  const identity = options.identity;
  const markets = Array.isArray(options.markets) ? options.markets : [];
  const usermetaTable = options.usermetaTable || 'wp_usermeta';
  const userIdExpr = options.userIdExpr || 'u.ID';

  if (isAdminIdentity(identity) && !options.filtered) {
    return;
  }

  if (!markets.length) {
    if (!shouldEnforceMarketScope(identity)) {
      return;
    }
    where.push('1=0');
    return;
  }

  const placeholders = markets.map(() => '?').join(', ');
  where.push(`EXISTS (SELECT 1 FROM \`${usermetaTable}\` pm WHERE pm.user_id = ${userIdExpr} AND pm.meta_key = '${PROFILE_MARKET_META_KEY}' AND UPPER(TRIM(pm.meta_value)) IN (${placeholders}))`);
  params.push(...markets);
}

function shouldEnforceMarketScope(identity) {
  return Boolean(identity && Array.isArray(identity.roles) && identity.roles.length);
}

function marketFromStripeAccount(stripeAccount) {
  const account = String(stripeAccount || '').trim().toLowerCase();
  if (account === 'br') {
    return 'BR';
  }
  if (account === 'us') {
    return 'US';
  }
  return '';
}

function assertStripeAccountMarket(identity, stripeAccount, env = process.env) {
  assertRecordMarket(identity, marketFromStripeAccount(stripeAccount), env);
}

function canAccessMarket(identity, country, env = process.env) {
  const normalized = normalizeMarketToken(country);
  if (!normalized) {
    return isAdminIdentity(identity);
  }

  return effectiveMarkets(identity, env).includes(normalized);
}

function canonicalMarketFromCountry(country) {
  return normalizeMarketToken(country) || null;
}

function assertRecordMarket(identity, country, env = process.env) {
  if (!canAccessMarket(identity, country, env)) {
    throw new HttpError(404, 'Not found.');
  }
}

function assertStaffMarketAssigned(identity, options = {}, env = process.env) {
  const marketScope = options.marketScope;
  if (!marketScope || marketScope === 'none') {
    return;
  }

  effectiveMarkets(identity, env);
}

function requiresStaffMarket(roles = []) {
  return Array.isArray(roles) && roles.length > 0 && !roles.includes('admin');
}

function parseStaffAssignmentMarket(input, roles = []) {
  if (!requiresStaffMarket(roles)) {
    return [];
  }

  const normalized = String((input && input.market) || '').trim().toUpperCase();
  if (normalized !== 'BR' && normalized !== 'US') {
    throw new HttpError(400, 'Invalid request payload.', { code: 'market_required' });
  }

  return [normalized];
}

module.exports = {
  ADMIN_MARKETS_META_KEY,
  MARKET_PERMISSIONS,
  PROFILE_MARKET_META_KEY,
  VALID_MARKETS,
  assertRecordMarket,
  assertStaffMarketAssigned,
  assertStripeAccountMarket,
  appendCustomerMarketFilter,
  appendInFilter,
  canAccessMarket,
  canonicalMarketFromCountry,
  constrainMarketQuery,
  effectiveMarkets,
  isAdminIdentity,
  isStaffMarketEnforced,
  marketFromStripeAccount,
  marketPermissions,
  marketsFromIdentity,
  parseMarkets,
  parseStaffAssignmentMarket,
  requiresStaffMarket,
  resolveStaffMarkets,
  shouldEnforceMarketScope,
  stripeAccountForMarkets
};
