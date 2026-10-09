const DEFAULT_MAX_ATTEMPTS = 8;

function toUnix(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

// One key per attempt: a retry or a resend changes `attempts` or `next_attempt_at`, so Stripe never replays a
// stored failure. The same row state gives the same key, so a crash between Stripe and MySQL stays safe.
function idempotencyKey(row) {
  const due = row.nextAttemptAt ? Date.parse(row.nextAttemptAt) : 0;
  return `delivery-calendar-sync:${row.id}:${Number(row.attempts) || 0}:${Number.isFinite(due) ? due : 0}`;
}

function stripeTrialEnd(subscription) {
  const value = subscription && subscription.trial_end;
  return value == null ? null : Number(value);
}

// Applies the trial_end a calendar closure queued. It writes only while Stripe still has the value the closure
// saw, so a skip, a postpone, or a charge that ran meanwhile is never overwritten.
class DeliveryCalendarStripeSyncService {
  constructor(options = {}) {
    this.repository = options.repository;
    // Each market charges through its own Stripe account.
    this.billingFor = options.billingFor || (() => options.billing);
    this.logger = options.logger || { info() {}, warn() {}, error() {} };
    this.now = options.now || (() => new Date());
    this.maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : DEFAULT_MAX_ATTEMPTS;
  }

  async syncOne(row) {
    const target = toUnix(row.targetTrialEnd);
    const expected = toUnix(row.expectedTrialEnd);
    try {
      const billing = this.billingFor(row.market);
      const subscription = await billing.retrieveSubscription(row.stripeSubscriptionId, { expand: [] });
      const current = stripeTrialEnd(subscription);
      if (current === target) {
        await this.repository.markSynced(row.id, this.now());
        return 'synced';
      }
      if (current !== expected) {
        await this.repository.markConflict(row.id, current == null ? null : new Date(current * 1000).toISOString());
        this.logger.warn({ syncId: row.id, subscriptionId: row.stripeSubscriptionId }, 'Calendar sync found an unexpected trial_end.');
        return 'conflict';
      }
      await billing.setTrialEnd({
        subscriptionId: row.stripeSubscriptionId,
        trial_end: target,
        proration_behavior: 'none',
        idempotencyKey: idempotencyKey(row)
      });
      await this.repository.markSynced(row.id, this.now());
      return 'synced';
    } catch (error) {
      this.logger.error({ syncId: row.id, subscriptionId: row.stripeSubscriptionId, err: error && error.message }, 'Calendar sync attempt failed.');
      const result = await this.repository.recordAttempt(row.id, {
        error,
        now: this.now(),
        attempts: row.attempts,
        maxAttempts: this.maxAttempts
      });
      return result.status === 'failed' ? 'failed' : 'retry';
    }
  }

  // A row that cannot even record its outcome is marked as an error and the tick goes on with the next row.
  async syncIsolated(row) {
    try {
      return await this.syncOne(row);
    } catch (error) {
      const message = String((error && error.message) || error || 'unknown error');
      this.logger.error({ syncId: row.id, subscriptionId: row.stripeSubscriptionId, err: message }, 'Calendar sync row could not be processed.');
      try {
        await this.repository.markError(row.id, message);
      } catch (markError) {
        this.logger.error({ syncId: row.id, err: markError && markError.message }, 'Calendar sync row could not be marked as an error.');
      }
      return 'error';
    }
  }

  async runDue() {
    const counts = { synced: 0, failed: 0, conflict: 0, retry: 0, error: 0 };
    const rows = await this.repository.claimDue(this.now());
    for (const row of rows) {
      const outcome = await this.syncIsolated(row);
      counts[outcome] += 1;
    }
    return counts;
  }
}

module.exports = {
  DeliveryCalendarStripeSyncService,
  idempotencyKey,
  DEFAULT_MAX_ATTEMPTS
};
