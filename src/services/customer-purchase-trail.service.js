const { HttpError } = require('../core/http-error');
const {
  ATTEMPT_AREAS,
  EVENT_AREAS,
  TRANSITIONS,
  RETENTION_DAYS,
  normalizeTrailMarket,
  isCorrelationId,
  newCorrelationId,
  safeToken,
  safeMessage,
  safeInteger,
  safeTerm
} = require('../core/purchase-trail');

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_BATCH = 1000;
const RETENTION_MAX_BATCHES = 50;
const FAILURE_DEFAULT_DAYS = 7;
const FAILURE_DEFAULT_LIMIT = 50;
const FAILURE_MAX_LIMIT = 100;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseInstant(value, { endOfDay = false } = {}) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const date = new Date(DATE_ONLY.test(text) ? `${text}T00:00:00.000Z` : text);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, 'Invalid period.', { code: 'invalid_period' });
  }
  // A plain "to" date includes that whole day.
  return endOfDay && DATE_ONLY.test(text) ? new Date(date.getTime() + DAY_MS) : date;
}

function encodeCursor(next) {
  return next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null;
}

function decodeCursor(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    const t = new Date(parsed.t);
    const id = Number(parsed.id);
    if (Number.isNaN(t.getTime()) || (parsed.k !== 'attempt' && parsed.k !== 'webhook') || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error('bad cursor');
    }
    return { t, k: parsed.k, id };
  } catch (_error) {
    throw new HttpError(400, 'Invalid cursor.', { code: 'invalid_cursor' });
  }
}

const FAILURE_AREAS = ['onboarding', 'plan', 'checkout', 'subscription', 'webhook'];
const ROW_ERROR_FIELDS = ['http_status', 'error_code', 'error_message', 'stripe_code', 'stripe_type', 'stripe_param'];

function pickError(source) {
  return Object.fromEntries(ROW_ERROR_FIELDS.map((field) => [field, source ? source[field] ?? null : null]));
}

// The failure a row shows: the last failed step (the last one with the filtered code, when there is one); else the
// attempt's own outcome.
function presentFailure(row, errorCode) {
  if (row.kind === 'webhook') {
    const event = row.event;
    return {
      kind: 'webhook',
      occurred_at: row.occurred_at,
      market: event.market,
      user_id: event.user_id,
      email: null,
      area: 'webhook',
      step: event.step,
      action: null,
      attempt_status: null,
      stripe_event_type: event.stripe_event_type,
      subscription_id: event.subscription_id,
      ...pickError(event),
      attempt: null,
      events: []
    };
  }
  const { attempt, events } = row;
  // Up to the row's instant: a later failure outside the period does not replace the one that dated the row.
  const until = row.occurred_at ? new Date(row.occurred_at).getTime() : Infinity;
  const failed = events.filter((event) => event.outcome === 'failed'
    && (!errorCode || event.error_code === errorCode)
    && (!event.created_at || new Date(event.created_at).getTime() <= until));
  const shown = failed[failed.length - 1] || null;
  return {
    kind: 'attempt',
    occurred_at: row.occurred_at,
    market: attempt.market,
    user_id: attempt.user_id,
    email: attempt.email,
    area: attempt.area,
    step: shown ? shown.step : attempt.final_step,
    action: shown ? shown.action : null,
    attempt_status: attempt.status,
    stripe_event_type: shown ? shown.stripe_event_type : null,
    subscription_id: attempt.subscription_id,
    ...pickError(shown || attempt),
    attempt: {
      id: attempt.id,
      area: attempt.area,
      status: attempt.status,
      final_step: attempt.final_step,
      error_code: attempt.error_code,
      attempt_id: attempt.attempt_id,
      term_months: attempt.term_months,
      currency: attempt.currency,
      subscription_id: attempt.subscription_id,
      started_at: attempt.started_at,
      finished_at: attempt.finished_at
    },
    events
  };
}

function errorColumns(error = {}) {
  const status = Number(error.httpStatus);
  return {
    http_status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    error_code: safeToken(error.code),
    error_message: safeMessage(error.message),
    stripe_code: safeToken(error.stripeCode),
    stripe_type: safeToken(error.stripeType),
    stripe_param: safeToken(error.stripeParam, 128)
  };
}

function stripeAccountOf(value) {
  return normalizeTrailMarket(value) || null;
}

// Writes the customer purchase trail. Every write is best effort: an error here is logged and swallowed, so the
// response, the webhook and the admin change that called it behave exactly as without the trail.
class CustomerPurchaseTrailService {
  constructor(options = {}) {
    this.repository = options.repository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.logger = options.logger || { warn() {}, error() {}, info() {} };
    this.now = options.now || (() => new Date());
  }

  warn(error, context) {
    this.logger.warn({ ...context, code: error && error.code, message: String(error && error.message || '') }, 'Purchase trail write failed.');
  }

  // Address country first; before an address, the market the store page sent.
  async resolveCustomerMarket(userId, requestMarket) {
    if (this.ledgerRepository && typeof this.ledgerRepository.findUserStateByUserId === 'function') {
      try {
        const state = await this.ledgerRepository.findUserStateByUserId(userId);
        const fromAddress = normalizeTrailMarket(state && state.address && state.address.country);
        if (fromAddress) {
          return fromAddress;
        }
      } catch (_error) {
        // Falls back to the page market.
      }
    }
    return normalizeTrailMarket(requestMarket);
  }

  // The market of a bought subscription is its Stripe account in the ledger.
  async resolveSubscriptionMarket(userId, subscriptionId) {
    if (!this.ledgerRepository || typeof this.ledgerRepository.findByUserIdAndSubscriptionId !== 'function') {
      return '';
    }
    try {
      const row = await this.ledgerRepository.findByUserIdAndSubscriptionId(userId, subscriptionId);
      return row ? normalizeTrailMarket(row.stripeAccount) : '';
    } catch (_error) {
      return '';
    }
  }

  // One journey step of an authenticated customer. Without a user or a market nothing is written.
  async recordStep(input = {}) {
    try {
      const userId = safeInteger(input.userId);
      const market = normalizeTrailMarket(input.market);
      const area = ATTEMPT_AREAS.includes(input.area) ? input.area : null;
      const step = safeToken(input.step, 48);
      if (!userId || !market || !area || !step || !this.repository) {
        return null;
      }
      const fields = input.fields || {};
      const correlationId = isCorrelationId(input.correlationId) ? String(input.correlationId).toLowerCase() : newCorrelationId();
      const error = errorColumns(input.error);
      const attemptRowId = await this.repository.openAttempt({
        user_id: userId,
        market,
        correlation_id: correlationId,
        area,
        email: safeMessage(input.email) ? String(input.email).trim().slice(0, 191) : null,
        stripe_account: stripeAccountOf(fields.stripeAccount),
        attempt_id: safeToken(fields.attemptId, 128),
        term_months: safeTerm(fields.termMonths),
        currency: safeToken(fields.currency, 3),
        promotion_code_id: safeToken(fields.promotionCodeId),
        subscription_id: safeToken(fields.subscriptionId),
        ip_hash: /^[0-9a-f]{64}$/.test(String(input.ipHash || '')) ? input.ipHash : null
      });
      await this.repository.insertEvent({
        attempt_row_id: attemptRowId,
        user_id: userId,
        market,
        area,
        step,
        action: safeToken(input.action, 48),
        outcome: input.outcome === 'ok' ? 'ok' : 'failed',
        pet_id: safeInteger(fields.petId),
        subscription_id: safeToken(fields.subscriptionId),
        stripe_account: stripeAccountOf(fields.stripeAccount),
        ...error
      });
      if (attemptRowId && TRANSITIONS.includes(input.transition)) {
        await this.repository.transitionAttempt(attemptRowId, input.transition, { final_step: step, ...error });
      }
      return { attemptRowId, correlationId, market };
    } catch (error) {
      this.warn(error, { area: input.area, step: input.step });
      return null;
    }
  }

  // A Stripe webhook outcome: terminal failure, customer not resolved, a failed payment, or a server-confirmed
  // payment that closes the checkout attempt as paid. Never the event payload.
  async recordWebhook(input = {}) {
    try {
      const market = normalizeTrailMarket(input.market);
      const step = safeToken(input.step, 48);
      if (!market || !step || !this.repository) {
        return null;
      }
      const userId = safeInteger(input.userId);
      const subscriptionId = safeToken(input.subscriptionId);
      const attemptId = safeToken(input.attemptId, 128);
      const attempt = userId
        ? await this.repository.findAttemptForPayment({ userId, market, subscriptionId, attemptId })
        : null;
      const error = errorColumns(input.error);
      const inserted = await this.repository.insertEvent({
        attempt_row_id: attempt ? attempt.id : null,
        user_id: userId,
        market,
        area: 'webhook',
        step,
        action: null,
        outcome: input.outcome === 'ok' ? 'ok' : 'failed',
        pet_id: null,
        subscription_id: subscriptionId,
        stripe_account: market,
        stripe_event_id: safeToken(input.eventId),
        stripe_event_type: safeToken(input.eventType),
        ...error
      });
      if (inserted && attempt && TRANSITIONS.includes(input.transition)) {
        await this.repository.transitionAttempt(attempt.id, input.transition, { final_step: step, ...error });
      }
      return { attemptRowId: attempt ? attempt.id : null };
    } catch (error) {
      this.warn(error, { area: 'webhook', step: input.step, eventId: input.eventId });
      return null;
    }
  }

  // A market setting changed by an operator. No customer user id; the operator audit stays where it is.
  async recordConfig(input = {}) {
    try {
      const market = normalizeTrailMarket(input.market);
      const action = safeToken(input.action);
      if (!market || !action || !this.repository) {
        return;
      }
      await this.repository.insertConfigEvent({
        market,
        stripe_account: stripeAccountOf(input.stripeAccount) || market,
        actor_admin_id: safeInteger(input.actorId),
        action,
        target_ref: safeToken(input.targetRef, 128),
        outcome: input.outcome === 'ok' ? 'ok' : 'failed',
        error_code: safeToken(input.errorCode)
      });
    } catch (error) {
      this.warn(error, { area: 'config', action: input.action });
    }
  }

  async findAttemptByAttemptId({ userId, market, attemptId }) {
    try {
      const id = safeToken(attemptId, 128);
      return id ? await this.repository.findAttemptByAttemptId({ userId, market, attemptId: id }) : null;
    } catch (_error) {
      return null;
    }
  }

  async listForCustomer({ userId, market, limit, before }) {
    return this.repository.listForCustomer({ userId, market, limit, before });
  }

  // Validates the period (default the last 7 days, never before the 180-day retention).
  resolvePeriod({ from, to } = {}) {
    const now = this.now();
    const end = parseInstant(to, { endOfDay: true }) || now;
    const start = parseInstant(from) || new Date(end.getTime() - FAILURE_DEFAULT_DAYS * DAY_MS);
    if (start.getTime() < now.getTime() - RETENTION_DAYS * DAY_MS) {
      throw new HttpError(400, 'The period starts before the 180-day retention.', { code: 'period_out_of_retention' });
    }
    if (start.getTime() >= end.getTime()) {
      throw new HttpError(400, 'Invalid period.', { code: 'invalid_period' });
    }
    return { from: start, to: end };
  }

  async listConfigEvents({ market, limit, before, outcome, from, to }) {
    const filters = {};
    if (outcome !== undefined && outcome !== null && outcome !== '') {
      if (outcome !== 'failed' && outcome !== 'ok') {
        throw new HttpError(400, 'Invalid outcome.', { code: 'invalid_outcome' });
      }
      filters.outcome = outcome;
    }
    if (from || to) {
      Object.assign(filters, this.resolvePeriod({ from, to }));
    }
    return this.repository.listConfigEvents({ market, limit, before, ...filters });
  }

  // purchase-error-monitor: failures already in the trail, one market, newest first. Read only.
  async listFailures({ market, from, to, area, errorCode, limit, before }) {
    const period = this.resolvePeriod({ from, to });
    const areaValue = area === undefined || area === null || area === '' ? null : String(area);
    if (areaValue && !FAILURE_AREAS.includes(areaValue)) {
      throw new HttpError(400, 'Invalid area.', { code: 'invalid_area' });
    }
    const codeValue = errorCode === undefined || errorCode === null || String(errorCode).trim() === '' ? null : safeToken(errorCode);
    if (errorCode && String(errorCode).trim() && !codeValue) {
      throw new HttpError(400, 'Invalid error code.', { code: 'invalid_error_code' });
    }
    const limitValue = limit === undefined || limit === null || limit === '' ? FAILURE_DEFAULT_LIMIT : Number(limit);
    if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > FAILURE_MAX_LIMIT) {
      throw new HttpError(400, 'Invalid limit.', { code: 'invalid_limit' });
    }
    const result = await this.repository.listFailures({
      market,
      ...period,
      area: areaValue,
      errorCode: codeValue,
      limit: limitValue,
      cursor: decodeCursor(before)
    });
    return {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      rows: result.rows.map((row) => presentFailure(row, codeValue)),
      next_before: encodeCursor(result.next)
    };
  }

  // purchase_trail_retention: 180 days, br and us alike, in bounded batches.
  async purgeExpired() {
    const cutoff = new Date(this.now().getTime() - RETENTION_DAYS * DAY_MS);
    const totals = { attempts: 0, events: 0, config_events: 0 };
    for (let batch = 0; batch < RETENTION_MAX_BATCHES; batch += 1) {
      const deleted = await this.repository.deleteOlderThan(cutoff, RETENTION_BATCH);
      totals.attempts += deleted.attempts;
      totals.events += deleted.events;
      totals.config_events += deleted.config_events;
      if (deleted.attempts < RETENTION_BATCH && deleted.events < RETENTION_BATCH && deleted.config_events < RETENTION_BATCH) {
        break;
      }
    }
    return totals;
  }
}

module.exports = {
  CustomerPurchaseTrailService,
  EVENT_AREAS
};
