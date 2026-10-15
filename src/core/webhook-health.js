const WEBHOOK_ACCOUNTS = ['br', 'us'];
const STALE_AFTER_HOURS = 72;
const OVERDUE_AFTER_MINUTES = 60;
const FAILURE_WINDOW_HOURS = 24;

const HOUR_MS = 60 * 60 * 1000;

function toIso(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// no_events: never received anything; attention: a failure in 24h, an event stuck for over an hour,
// or silence longer than STALE_AFTER_HOURS; ok otherwise.
function webhookStatus({ lastEventAt, failedLast24h = 0, pendingOverdue = 0 }, now = new Date()) {
  const last = toIso(lastEventAt);
  if (!last) {
    return 'no_events';
  }
  if (failedLast24h > 0 || pendingOverdue > 0) {
    return 'attention';
  }
  if (now.getTime() - new Date(last).getTime() > STALE_AFTER_HOURS * HOUR_MS) {
    return 'attention';
  }
  return 'ok';
}

function webhookHealthWindows(now = new Date()) {
  return {
    failedSince: new Date(now.getTime() - FAILURE_WINDOW_HOURS * HOUR_MS),
    overdueBefore: new Date(now.getTime() - OVERDUE_AFTER_MINUTES * 60 * 1000)
  };
}

function buildWebhookHealth(rows = [], now = new Date()) {
  const byAccount = new Map((Array.isArray(rows) ? rows : []).map((row) => [String(row.account || '').toLowerCase(), row]));
  return {
    generatedAt: now.toISOString(),
    staleAfterHours: STALE_AFTER_HOURS,
    accounts: WEBHOOK_ACCOUNTS.map((account) => {
      const row = byAccount.get(account) || {};
      const lastEventAt = toIso(row.lastEventAt);
      const entry = {
        account,
        lastEventAt,
        lastEventType: lastEventAt && row.lastEventType ? String(row.lastEventType) : null,
        failedLast24h: Number(row.failedLast24h || 0),
        pendingOverdue: Number(row.pendingOverdue || 0)
      };
      return { ...entry, status: webhookStatus(entry, now) };
    })
  };
}

module.exports = {
  FAILURE_WINDOW_HOURS,
  OVERDUE_AFTER_MINUTES,
  STALE_AFTER_HOURS,
  WEBHOOK_ACCOUNTS,
  buildWebhookHealth,
  webhookHealthWindows,
  webhookStatus
};
