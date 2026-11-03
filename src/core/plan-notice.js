const { resolveAutoRenew } = require('./contract-deliveries');
const { ledgerStripeAccount } = require('./stripe-account');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOTICE_KINDS = { renewal: 'renewal', ending: 'ending' };
const PLAN_NOTICE_TEMPLATES = { renewal: 'renewal_notice', ending: 'plan_ending_notice' };
const EMAIL_STATUSES = new Set(['active', 'trialing']);
const ENDING_BANNER_STATUSES = new Set(['active', 'trialing', 'past_due', 'paused']);

function toInstant(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim().replace(' ', 'T');
  const date = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(text) ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// A null count on a one-month plan still renews: every charge after the first starts a new contract. On a
// longer term it could be an instalment, so nothing is announced. A stored 0 has no contract to renew yet.
function nextChargeStartsContract(row) {
  const term = Math.max(1, Number(row.subscriptionTermMonths || (row.planSelection || {}).subscription_term_months) || 1);
  const charged = row.chargedDeliveries;
  if (charged == null) return term === 1;
  return Number(charged) > 0 && Number(charged) % term === 0;
}

/**
 * The notice a subscription shows now (plan-notices), or null: `kind`, the exact period end as `date`, whole
 * `daysLeft`, and `emailable`. An explicit cancellation keeps the banner and is not emailable: only a stored
 * `autoRenew === false` means the customer let the contract run out.
 */
function planNoticeFor(row, { now = new Date(), noticeDays } = {}) {
  const date = toInstant(row && row.currentPeriodEnd);
  const days = Number(noticeDays);
  if (!date || !Number.isFinite(days)) return null;
  const left = date.getTime() - now.getTime();
  if (left < 0 || left > days * DAY_MS) return null;

  const base = { date, daysLeft: Math.ceil(left / DAY_MS) };
  const status = String(row.status || '');
  if (row.cancelAtPeriodEnd) {
    if (!ENDING_BANNER_STATUSES.has(status)) return null;
    return { ...base, kind: NOTICE_KINDS.ending, emailable: EMAIL_STATUSES.has(status) && row.autoRenew === false };
  }
  if (!EMAIL_STATUSES.has(status) || !resolveAutoRenew(row) || !nextChargeStartsContract(row)) return null;
  return { ...base, kind: NOTICE_KINDS.renewal, emailable: true };
}

function planNoticeReference(notice) {
  return `${PLAN_NOTICE_TEMPLATES[notice.kind]}:${Math.floor(notice.date.getTime() / 1000)}`;
}

function planNoticePayload(notice) {
  if (!notice) return null;
  return { kind: notice.kind, date: notice.date.toISOString(), days_left: notice.daysLeft };
}

// The `plan_notice` of a dashboard read. `windows` keeps each market's window for one request. A settings failure
// costs the banner, never the dashboard.
async function dashboardPlanNotice(row, settingsRepository, windows = new Map(), now = new Date()) {
  if (!settingsRepository) return null;
  const market = ledgerStripeAccount(row) === 'br' ? 'BR' : 'US';
  try {
    if (!windows.has(market)) windows.set(market, settingsRepository.forMarket(market));
    const settings = await windows.get(market);
    return planNoticePayload(planNoticeFor(row, { now, noticeDays: settings.planNoticeDays }));
  } catch (_error) {
    return null;
  }
}

module.exports = {
  NOTICE_KINDS,
  PLAN_NOTICE_TEMPLATES,
  dashboardPlanNotice,
  planNoticeFor,
  planNoticePayload,
  planNoticeReference
};
