const { HttpError } = require('../../core/http-error');
const { MAX_EVENTS_PER_ATTEMPT } = require('../../core/purchase-trail');

const ATTEMPTS = 'customer_purchase_attempts';
const EVENTS = 'customer_purchase_events';
const CONFIG_EVENTS = 'customer_purchase_config_events';

const ERROR_FIELDS = ['http_status', 'error_code', 'error_message', 'stripe_code', 'stripe_type', 'stripe_param'];
// Attempt columns a later step may fill. A value already there is kept when the step has none (COALESCE).
const ATTEMPT_FILL_FIELDS = ['email', 'stripe_account', 'attempt_id', 'term_months', 'currency', 'promotion_code_id', 'subscription_id', 'ip_hash'];
const EVENT_FIELDS = [
  'attempt_row_id', 'user_id', 'market', 'area', 'step', 'action', 'outcome', 'pet_id', 'subscription_id',
  'stripe_account', 'stripe_event_id', 'stripe_event_type', ...ERROR_FIELDS
];
const CONFIG_FIELDS = ['market', 'stripe_account', 'actor_admin_id', 'action', 'target_ref', 'outcome', 'error_code'];

function iso(value) {
  if (value == null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapError(row) {
  return {
    http_status: row.http_status == null ? null : Number(row.http_status),
    error_code: row.error_code || null,
    error_message: row.error_message || null,
    stripe_code: row.stripe_code || null,
    stripe_type: row.stripe_type || null,
    stripe_param: row.stripe_param || null
  };
}

function mapAttempt(row) {
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    market: row.market,
    email: row.email || null,
    stripe_account: row.stripe_account || null,
    correlation_id: row.correlation_id,
    attempt_id: row.attempt_id || null,
    area: row.area,
    term_months: row.term_months == null ? null : Number(row.term_months),
    currency: row.currency || null,
    promotion_code_id: row.promotion_code_id || null,
    subscription_id: row.subscription_id || null,
    status: row.status,
    final_step: row.final_step || null,
    ...mapError(row),
    started_at: iso(row.started_at),
    finished_at: iso(row.finished_at)
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    attempt_row_id: row.attempt_row_id == null ? null : Number(row.attempt_row_id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    market: row.market,
    area: row.area,
    step: row.step,
    action: row.action || null,
    outcome: row.outcome,
    pet_id: row.pet_id == null ? null : Number(row.pet_id),
    subscription_id: row.subscription_id || null,
    stripe_account: row.stripe_account || null,
    stripe_event_id: row.stripe_event_id || null,
    stripe_event_type: row.stripe_event_type || null,
    ...mapError(row),
    created_at: iso(row.created_at)
  };
}

function mapConfigEvent(row) {
  return {
    id: Number(row.id),
    market: row.market,
    stripe_account: row.stripe_account || null,
    actor_admin_id: row.actor_admin_id == null ? null : Number(row.actor_admin_id),
    action: row.action,
    target_ref: row.target_ref || null,
    outcome: row.outcome,
    error_code: row.error_code || null,
    created_at: iso(row.created_at)
  };
}

function valueOf(row, field) {
  return row[field] === undefined ? null : row[field];
}

class CustomerPurchaseTrailRepository {
  constructor(dataSource) {
    this.dataSource = dataSource;
  }

  ensureDataSource() {
    if (!this.dataSource || (this.dataSource.isInitialized === false)) {
      throw new HttpError(503, 'Database connection is not initialized.');
    }
  }

  // One row per (user, market, correlation): the same correlation in the other market is another attempt.
  // The area moves forward only (onboarding -> plan -> checkout); subscription stays its own.
  async openAttempt(row) {
    this.ensureDataSource();
    const fill = ATTEMPT_FILL_FIELDS.map((field) => `\`${field}\` = COALESCE(VALUES(\`${field}\`), \`${field}\`)`);
    const result = await this.dataSource.query(
      [
        `INSERT INTO \`${ATTEMPTS}\``,
        `(\`user_id\`, \`market\`, \`correlation_id\`, \`area\`, ${ATTEMPT_FILL_FIELDS.map((field) => `\`${field}\``).join(', ')})`,
        `VALUES (?, ?, ?, ?, ${ATTEMPT_FILL_FIELDS.map(() => '?').join(', ')})`,
        'ON DUPLICATE KEY UPDATE `id` = LAST_INSERT_ID(`id`),',
        "`area` = IF(FIELD(VALUES(`area`), 'onboarding', 'plan', 'checkout', 'subscription') > FIELD(`area`, 'onboarding', 'plan', 'checkout', 'subscription'), VALUES(`area`), `area`),",
        fill.join(', ')
      ].join(' '),
      [row.user_id, row.market, row.correlation_id, row.area, ...ATTEMPT_FILL_FIELDS.map((field) => valueOf(row, field))]
    );
    return Number(result && result.insertId) || null;
  }

  // paid is final and replaces failed; failed and completed never replace paid.
  async transitionAttempt(id, transition, fields = {}) {
    this.ensureDataSource();
    const errors = transition === 'paid'
      ? ERROR_FIELDS.map((field) => `\`${field}\` = NULL`)
      : ERROR_FIELDS.map((field) => `\`${field}\` = ?`);
    const params = [transition, fields.final_step || null];
    if (transition !== 'paid') {
      params.push(...ERROR_FIELDS.map((field) => valueOf(fields, field)));
    }
    params.push(id);
    const result = await this.dataSource.query(
      [
        `UPDATE \`${ATTEMPTS}\` SET \`status\` = ?, \`final_step\` = ?,`,
        errors.join(', '),
        ', `finished_at` = UTC_TIMESTAMP()',
        "WHERE `id` = ? AND `status` <> 'paid'"
      ].join(' '),
      params
    );
    return Number(result && result.affectedRows) || 0;
  }

  async findAttemptByAttemptId({ userId, market, attemptId }) {
    this.ensureDataSource();
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${ATTEMPTS}\` WHERE \`user_id\` = ? AND \`market\` = ? AND \`attempt_id\` = ? ORDER BY \`id\` DESC LIMIT 1`,
      [userId, market, attemptId]
    );
    return Array.isArray(rows) && rows[0] ? mapAttempt(rows[0]) : null;
  }

  // The purchase attempt (never a later subscription change) a Stripe payment belongs to: by its subscription, or by the attempt id of the checkout.
  async findAttemptForPayment({ userId, market, subscriptionId, attemptId }) {
    this.ensureDataSource();
    const where = [];
    const params = [userId, market];
    if (subscriptionId) {
      where.push('`subscription_id` = ?');
      params.push(subscriptionId);
    }
    if (attemptId) {
      where.push('`attempt_id` = ?');
      params.push(attemptId);
    }
    if (!where.length) {
      return null;
    }
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${ATTEMPTS}\` WHERE \`user_id\` = ? AND \`market\` = ? AND \`area\` <> 'subscription' AND (${where.join(' OR ')}) ORDER BY \`id\` DESC LIMIT 1`,
      params
    );
    return Array.isArray(rows) && rows[0] ? mapAttempt(rows[0]) : null;
  }

  // INSERT IGNORE: a redelivered webhook hits the (stripe_event_id, step) unique key and writes nothing.
  async insertEvent(row) {
    this.ensureDataSource();
    const result = await this.dataSource.query(
      `INSERT IGNORE INTO \`${EVENTS}\` (${EVENT_FIELDS.map((field) => `\`${field}\``).join(', ')}) VALUES (${EVENT_FIELDS.map(() => '?').join(', ')})`,
      EVENT_FIELDS.map((field) => valueOf(row, field))
    );
    return Number(result && result.affectedRows) || 0;
  }

  async insertConfigEvent(row) {
    this.ensureDataSource();
    await this.dataSource.query(
      `INSERT INTO \`${CONFIG_EVENTS}\` (${CONFIG_FIELDS.map((field) => `\`${field}\``).join(', ')}) VALUES (${CONFIG_FIELDS.map(() => '?').join(', ')})`,
      CONFIG_FIELDS.map((field) => valueOf(row, field))
    );
  }

  // Attempts of one customer in one market, newest first, each with up to 50 events; plus that customer's
  // webhook events of that market that no attempt claimed.
  async listForCustomer({ userId, market, limit = 20, before = null }) {
    this.ensureDataSource();
    const params = [userId, market];
    let beforeSql = '';
    if (before) {
      beforeSql = ' AND `id` < ?';
      params.push(before);
    }
    params.push(limit);
    const attemptRows = await this.dataSource.query(
      `SELECT * FROM \`${ATTEMPTS}\` WHERE \`user_id\` = ? AND \`market\` = ?${beforeSql} ORDER BY \`started_at\` DESC, \`id\` DESC LIMIT ?`,
      params
    );
    const attempts = (Array.isArray(attemptRows) ? attemptRows : []).map(mapAttempt);
    for (const attempt of attempts) {
      const eventRows = await this.dataSource.query(
        `SELECT * FROM \`${EVENTS}\` WHERE \`attempt_row_id\` = ? AND \`market\` = ? ORDER BY \`id\` ASC LIMIT ?`,
        [attempt.id, market, MAX_EVENTS_PER_ATTEMPT]
      );
      attempt.events = (Array.isArray(eventRows) ? eventRows : []).map(mapEvent);
    }
    const unlinkedRows = await this.dataSource.query(
      `SELECT * FROM \`${EVENTS}\` WHERE \`user_id\` = ? AND \`market\` = ? AND \`attempt_row_id\` IS NULL ORDER BY \`id\` DESC LIMIT ?`,
      [userId, market, MAX_EVENTS_PER_ATTEMPT]
    );
    return {
      attempts,
      unlinked_events: (Array.isArray(unlinkedRows) ? unlinkedRows : []).map(mapEvent),
      next_before: attempts.length === limit ? attempts[attempts.length - 1].id : null
    };
  }

  // outcome/from/to are optional: without them this is the query the customer tab has always made.
  async listConfigEvents({ market, limit = 50, before = null, outcome = null, from = null, to = null }) {
    this.ensureDataSource();
    const params = [market];
    let filterSql = '';
    if (outcome) {
      filterSql += ' AND `outcome` = ?';
      params.push(outcome);
    }
    if (from) {
      filterSql += ' AND `created_at` >= ?';
      params.push(from);
    }
    if (to) {
      filterSql += ' AND `created_at` < ?';
      params.push(to);
    }
    if (before) {
      filterSql += ' AND `id` < ?';
      params.push(before);
    }
    params.push(limit);
    const rows = await this.dataSource.query(
      `SELECT * FROM \`${CONFIG_EVENTS}\` WHERE \`market\` = ?${filterSql} ORDER BY \`id\` DESC LIMIT ?`,
      params
    );
    const events = (Array.isArray(rows) ? rows : []).map(mapConfigEvent);
    return { events, next_before: events.length === limit ? events[events.length - 1].id : null };
  }

  // purchase-error-monitor: failure rows of one market, newest first. A row is an attempt with a failure (status
  // failed, or any failed step) dated by the failure shown (its last failed step, or finished_at when only the
  // outcome failed), or a failed webhook event no attempt claimed, dated by created_at. The area filter is the
  // attempt's own area; webhook keeps only the unclaimed webhook events. Cursor: (occurred_at, kind, id).
  async listFailures({ market, from, to, area = null, errorCode = null, limit = 50, cursor = null }) {
    this.ensureDataSource();
    const branches = [];
    const params = [];
    if (area !== 'webhook') {
      const codeOnEvents = errorCode ? ' AND `error_code` = ?' : '';
      const failedOutcome = errorCode ? "(a.`status` = 'failed' AND a.`error_code` = ?)" : "a.`status` = 'failed'";
      branches.push([
        "SELECT 'attempt' AS kind, a.`id` AS id, COALESCE(f.failed_at, a.`finished_at`) AS occurred_at",
        `FROM \`${ATTEMPTS}\` a`,
        `LEFT JOIN (SELECT \`attempt_row_id\`, MAX(\`created_at\`) AS failed_at FROM \`${EVENTS}\``,
        `WHERE \`market\` = ? AND \`outcome\` = 'failed' AND \`attempt_row_id\` IS NOT NULL AND \`created_at\` >= ? AND \`created_at\` < ?${codeOnEvents} GROUP BY \`attempt_row_id\`) f`,
        'ON f.`attempt_row_id` = a.`id`',
        `WHERE a.\`market\` = ?${area ? ' AND a.`area` = ?' : ''} AND (f.failed_at IS NOT NULL OR ${failedOutcome})`
      ].join(' '));
      params.push(market, from, to);
      if (errorCode) params.push(errorCode);
      params.push(market);
      if (area) params.push(area);
      if (errorCode) params.push(errorCode);
    }
    if (!area || area === 'webhook') {
      branches.push([
        "SELECT 'webhook' AS kind, e.`id` AS id, e.`created_at` AS occurred_at",
        `FROM \`${EVENTS}\` e`,
        "WHERE e.`market` = ? AND e.`area` = 'webhook' AND e.`outcome` = 'failed' AND e.`attempt_row_id` IS NULL",
        errorCode ? 'AND e.`error_code` = ?' : ''
      ].join(' '));
      params.push(market);
      if (errorCode) params.push(errorCode);
    }

    let cursorSql = '';
    if (cursor) {
      cursorSql = ' AND (u.occurred_at < ? OR (u.occurred_at = ? AND (u.kind < ? OR (u.kind = ? AND u.id < ?))))';
      params.push(from, to, cursor.t, cursor.t, cursor.k, cursor.k, cursor.id);
    } else {
      params.push(from, to);
    }
    params.push(limit + 1);
    const keys = await this.dataSource.query(
      `SELECT u.kind, u.id, u.occurred_at FROM (${branches.join(' UNION ALL ')}) u WHERE u.occurred_at >= ? AND u.occurred_at < ?${cursorSql} ORDER BY u.occurred_at DESC, u.kind DESC, u.id DESC LIMIT ?`,
      params
    );
    const page = (Array.isArray(keys) ? keys : []).slice(0, limit);
    const more = Array.isArray(keys) && keys.length > limit;

    const attemptIds = page.filter((row) => row.kind === 'attempt').map((row) => Number(row.id));
    const webhookIds = page.filter((row) => row.kind === 'webhook').map((row) => Number(row.id));
    const attempts = new Map();
    const eventsByAttempt = new Map();
    const webhooks = new Map();
    if (attemptIds.length) {
      const rows = await this.dataSource.query(`SELECT * FROM \`${ATTEMPTS}\` WHERE \`id\` IN (?) AND \`market\` = ?`, [attemptIds, market]);
      for (const row of rows || []) attempts.set(Number(row.id), mapAttempt(row));
      const eventRows = await this.dataSource.query(
        `SELECT * FROM \`${EVENTS}\` WHERE \`attempt_row_id\` IN (?) AND \`market\` = ? ORDER BY \`attempt_row_id\`, \`id\``,
        [attemptIds, market]
      );
      for (const row of eventRows || []) {
        const list = eventsByAttempt.get(Number(row.attempt_row_id)) || [];
        if (list.length < MAX_EVENTS_PER_ATTEMPT) list.push(mapEvent(row));
        eventsByAttempt.set(Number(row.attempt_row_id), list);
      }
    }
    if (webhookIds.length) {
      const rows = await this.dataSource.query(`SELECT * FROM \`${EVENTS}\` WHERE \`id\` IN (?) AND \`market\` = ?`, [webhookIds, market]);
      for (const row of rows || []) webhooks.set(Number(row.id), mapEvent(row));
    }

    const rows = page.map((key) => {
      const occurredAt = iso(key.occurred_at);
      if (key.kind === 'attempt') {
        const attempt = attempts.get(Number(key.id));
        return attempt ? { kind: 'attempt', id: Number(key.id), occurred_at: occurredAt, attempt, events: eventsByAttempt.get(Number(key.id)) || [] } : null;
      }
      const event = webhooks.get(Number(key.id));
      return event ? { kind: 'webhook', id: Number(key.id), occurred_at: occurredAt, event } : null;
    }).filter(Boolean);
    const last = page[page.length - 1];
    return {
      rows,
      next: more && last ? { t: iso(last.occurred_at), k: last.kind, id: Number(last.id) } : null
    };
  }

  // One batch per table; attempts take their events with them (ON DELETE CASCADE). Same cutoff for br and us.
  async deleteOlderThan(cutoff, batch = 1000) {
    this.ensureDataSource();
    const attempts = await this.dataSource.query(
      `DELETE FROM \`${ATTEMPTS}\` WHERE \`started_at\` < ? ORDER BY \`id\` LIMIT ?`,
      [cutoff, batch]
    );
    const events = await this.dataSource.query(
      `DELETE FROM \`${EVENTS}\` WHERE \`created_at\` < ? ORDER BY \`id\` LIMIT ?`,
      [cutoff, batch]
    );
    const configEvents = await this.dataSource.query(
      `DELETE FROM \`${CONFIG_EVENTS}\` WHERE \`created_at\` < ? ORDER BY \`id\` LIMIT ?`,
      [cutoff, batch]
    );
    return {
      attempts: Number(attempts && attempts.affectedRows) || 0,
      events: Number(events && events.affectedRows) || 0,
      config_events: Number(configEvents && configEvents.affectedRows) || 0
    };
  }
}

module.exports = {
  CustomerPurchaseTrailRepository,
  PURCHASE_TRAIL_TABLES: { ATTEMPTS, EVENTS, CONFIG_EVENTS }
};
