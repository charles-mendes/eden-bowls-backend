const crypto = require('crypto');

const CONSENT_TYPES = [
  'privacy_policy',
  'terms',
  'marketing_email',
  'analytics',
  'ads',
  'share_opt_out'
];

const CONSENT_SOURCES = ['otp_verify', 'banner', 'preferences', 'gpc', 'do_not_sell'];

const REQUEST_TYPES = ['access', 'deletion', 'correction', 'portability', 'opt_out_share'];
const REQUEST_STATUSES = ['open', 'in_progress', 'completed', 'rejected'];
const TERMINAL_REQUEST_STATUSES = ['completed', 'rejected'];
const IDENTITY_STATUSES = ['verified_session', 'verified_account_email', 'unverified'];
const REQUEST_CHANNELS = ['in_app', 'email'];

const SLA_DAYS = {
  BR: 15,
  US: 45
};

const TYPES_REQUIRING_IDENTITY_TO_COMPLETE = ['access', 'deletion', 'portability'];

function addCalendarDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + Number(days));
  return next;
}

function normalizeMarket(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (raw === 'BR' || raw === 'COM.BR') {
    return 'BR';
  }
  return 'US';
}

function slaDaysForMarket(market) {
  return SLA_DAYS[normalizeMarket(market)] || SLA_DAYS.US;
}

function dueAtForMarket(createdAt, market) {
  return addCalendarDays(createdAt, slaDaysForMarket(market));
}

function hashIp(ip, pepper = '') {
  const value = String(ip || '').trim();
  if (!value) {
    return '';
  }
  return crypto.createHash('sha256').update(`${value}|${pepper}`).digest('hex');
}

function truncateUserAgent(value) {
  return String(value || '').trim().slice(0, 255);
}

function isTerminalStatus(status) {
  return TERMINAL_REQUEST_STATUSES.includes(String(status || ''));
}

function isIdentityVerified(status) {
  return status === 'verified_session' || status === 'verified_account_email';
}

function toIso(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

module.exports = {
  CONSENT_TYPES,
  CONSENT_SOURCES,
  REQUEST_TYPES,
  REQUEST_STATUSES,
  TERMINAL_REQUEST_STATUSES,
  IDENTITY_STATUSES,
  REQUEST_CHANNELS,
  SLA_DAYS,
  TYPES_REQUIRING_IDENTITY_TO_COMPLETE,
  addCalendarDays,
  normalizeMarket,
  slaDaysForMarket,
  dueAtForMarket,
  hashIp,
  truncateUserAgent,
  isTerminalStatus,
  isIdentityVerified,
  toIso
};
