// customer-purchase-trail: the values a trail row may hold, and the helpers that keep anything else out of it.
const crypto = require('crypto');

const PURCHASE_TRAIL_MARKETS = ['br', 'us'];
const ATTEMPT_AREAS = ['onboarding', 'plan', 'checkout', 'subscription'];
const EVENT_AREAS = [...ATTEMPT_AREAS, 'webhook'];
const ATTEMPT_STATUSES = ['in_progress', 'paid', 'completed', 'failed'];
const TRANSITIONS = ['failed', 'paid', 'completed'];
const CORRELATION_HEADER = 'x-purchase-correlation-id';
const RETENTION_DAYS = 180;
const MAX_EVENTS_PER_ATTEMPT = 50;
const MESSAGE_MAX = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_.:-]+$/;

function normalizeTrailMarket(value) {
  const market = String(value || '').trim().toLowerCase();
  if (market === 'br' || market === 'us') {
    return market;
  }
  // A country (BR/US) or a MARKETS entry ({ country: 'BR' }).
  const country = value && typeof value === 'object' ? value.country : value;
  const normalized = String(country || '').trim().toLowerCase();
  return normalized === 'br' || normalized === 'us' ? normalized : '';
}

function isCorrelationId(value) {
  return UUID_PATTERN.test(String(value || '').trim());
}

function newCorrelationId() {
  return crypto.randomUUID();
}

// Codes, ids and Stripe fields: short identifiers only, so free text never lands in a code column.
function safeToken(value, max = 64) {
  const text = String(value == null ? '' : value).trim();
  if (!text || text.length > max || !TOKEN_PATTERN.test(text)) {
    return null;
  }
  return text;
}

// The message already returned to the customer, cut to the column.
function safeMessage(value) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, MESSAGE_MAX) : null;
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function safeTerm(value) {
  const number = safeInteger(value);
  return number && number <= 60 ? number : null;
}

function currencyForMarket(market) {
  return market === 'br' ? 'BRL' : market === 'us' ? 'USD' : null;
}

module.exports = {
  PURCHASE_TRAIL_MARKETS,
  ATTEMPT_AREAS,
  EVENT_AREAS,
  ATTEMPT_STATUSES,
  TRANSITIONS,
  CORRELATION_HEADER,
  RETENTION_DAYS,
  MAX_EVENTS_PER_ATTEMPT,
  MESSAGE_MAX,
  normalizeTrailMarket,
  isCorrelationId,
  newCorrelationId,
  safeToken,
  safeMessage,
  safeInteger,
  safeTerm,
  currencyForMarket
};
