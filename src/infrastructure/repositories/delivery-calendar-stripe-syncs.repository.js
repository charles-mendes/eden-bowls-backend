const { toMysqlDateTime } = require('../../core/stripe-subscription-map');

const TABLE = 'delivery_calendar_stripe_syncs';
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const BASE_BACKOFF_MS = 60 * 1000;

function isoOrNull(value) {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function mapRow(row) {
  return {
    id: Number(row.id),
    stripeSubscriptionId: row.stripe_subscription_id,
    market: row.market,
    auditEventId: row.audit_event_id == null ? null : Number(row.audit_event_id),
    expectedTrialEnd: isoOrNull(row.expected_trial_end),
    targetTrialEnd: isoOrNull(row.target_trial_end),
    foundTrialEnd: isoOrNull(row.found_trial_end),
    status: row.status,
    attempts: Number(row.attempts) || 0,
    lastError: row.last_error || null,
    nextAttemptAt: isoOrNull(row.next_attempt_at),
    createdAt: isoOrNull(row.created_at),
    syncedAt: isoOrNull(row.synced_at)
  };
}

// Exponential backoff from one minute, capped at an hour.
function backoffMs(attempts) {
  return Math.min(BASE_BACKOFF_MS * (2 ** Math.max(0, attempts - 1)), MAX_BACKOFF_MS);
}

class DeliveryCalendarStripeSyncsRepository {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  // `executor` is the closure's transaction. A pending row of the same subscription is superseded, and the new
  // row keeps that row's expected value, so only one pending row per subscription ever writes to Stripe.
  async insertPending(executor, { stripeSubscriptionId, market, auditEventId = null, expectedTrialEnd, targetTrialEnd }) {
    const db = executor || this.dataSource;
    const pending = await db.query(
      `SELECT id, expected_trial_end FROM ${TABLE}
        WHERE stripe_subscription_id = ? AND status = 'pending'
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      [stripeSubscriptionId]
    );
    let expected = toMysqlDateTime(expectedTrialEnd);
    if (pending.length > 0) {
      expected = pending[0].expected_trial_end == null ? null : toMysqlDateTime(pending[0].expected_trial_end);
      await db.query(
        `UPDATE ${TABLE} SET status = 'superseded', next_attempt_at = NULL
          WHERE stripe_subscription_id = ? AND status = 'pending'`,
        [stripeSubscriptionId]
      );
    }
    const result = await db.query(
      `INSERT INTO ${TABLE}
        (stripe_subscription_id, market, audit_event_id, expected_trial_end, target_trial_end, status, attempts)
       VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
      [stripeSubscriptionId, market, auditEventId, expected, toMysqlDateTime(targetTrialEnd)]
    );
    return Number(result.insertId);
  }

  async linkAuditEvent(executor, ids, auditEventId) {
    if (!ids || ids.length === 0) return;
    const db = executor || this.dataSource;
    await db.query(
      `UPDATE ${TABLE} SET audit_event_id = ? WHERE id IN (${ids.map(() => '?').join(', ')})`,
      [auditEventId, ...ids]
    );
  }

  async findById(id) {
    const rows = await this.dataSource.query(`SELECT * FROM ${TABLE} WHERE id = ?`, [id]);
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  // The job holds a MySQL named lock per tick, so claiming needs no row lock.
  async claimDue(now, limit = 50) {
    const rows = await this.dataSource.query(
      `SELECT * FROM ${TABLE}
        WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ORDER BY id LIMIT ?`,
      [toMysqlDateTime(now), limit]
    );
    return rows.map(mapRow);
  }

  async markSynced(id, now) {
    await this.dataSource.query(
      `UPDATE ${TABLE} SET status = 'synced', synced_at = ?, next_attempt_at = NULL, last_error = NULL
        WHERE id = ? AND status = 'pending'`,
      [toMysqlDateTime(now), id]
    );
  }

  async markConflict(id, foundTrialEnd) {
    await this.dataSource.query(
      `UPDATE ${TABLE} SET status = 'conflict', found_trial_end = ?, next_attempt_at = NULL
        WHERE id = ? AND status = 'pending'`,
      [toMysqlDateTime(foundTrialEnd), id]
    );
  }

  // One more attempt; the row becomes failed once it reaches `maxAttempts`.
  async recordAttempt(id, { error, now, attempts, maxAttempts }) {
    const next = attempts + 1;
    const message = String((error && error.message) || error || 'unknown error').slice(0, 500);
    if (next >= maxAttempts) {
      await this.dataSource.query(
        `UPDATE ${TABLE} SET status = 'failed', attempts = ?, last_error = ?, next_attempt_at = NULL
          WHERE id = ? AND status = 'pending'`,
        [next, message, id]
      );
      return { status: 'failed', attempts: next };
    }
    const nextAttemptAt = new Date(now.getTime() + backoffMs(next));
    await this.dataSource.query(
      `UPDATE ${TABLE} SET attempts = ?, last_error = ?, next_attempt_at = ?
        WHERE id = ? AND status = 'pending'`,
      [next, message, toMysqlDateTime(nextAttemptAt), id]
    );
    return { status: 'pending', attempts: next, nextAttemptAt: nextAttemptAt.toISOString() };
  }
}

module.exports = {
  DeliveryCalendarStripeSyncsRepository,
  backoffMs
};
