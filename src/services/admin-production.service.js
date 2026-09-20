const { DateTime } = require('luxon');
const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { parseStripeAccountInput } = require('../core/stripe-account');
const { toMysqlDateTime } = require('../core/stripe-subscription-map');
const {
  DEFAULT_TIMEZONE,
  dueBucket,
  presentProductionQueueItem
} = require('../core/production-queue-presenter');

const QUEUE_MEMBERSHIP_STATUSES = new Set(['active', 'trialing', 'past_due']);

const ALLOWED_TRANSITIONS = {
  to_prepare: new Set(['in_production', 'blocked']),
  in_production: new Set(['ready', 'blocked']),
  ready: new Set(['in_production']),
  blocked: new Set(['to_prepare'])
};

function resolveTimezone(value) {
  const timezone = String(value || '').trim() || DEFAULT_TIMEZONE;
  if (!DateTime.now().setZone(timezone).isValid) {
    throw new HttpError(400, 'Invalid timezone.', { code: 'invalid_timezone' });
  }
  return timezone;
}

function civilBounds({ timezone, windowDays, now = new Date() }) {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  return {
    startOfToday: today.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
    windowEndExclusive: today.plus({ days: windowDays }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
    overdueFloor: today.minus({ days: windowDays }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss')
  };
}

function isQueueEligible(row) {
  return Boolean(
    row
    && QUEUE_MEMBERSHIP_STATUSES.has(String(row.status || ''))
    && !row.cancelAtPeriodEnd
    && row.currentPeriodEnd
  );
}

function periodEndsMatch(left, right) {
  return Boolean(left && right && toMysqlDateTime(left) === toMysqlDateTime(right));
}

function emptyMetrics() {
  return { today: 0, tomorrow: 0, upcoming: 0, overdue: 0 };
}

function bucketMetrics(rows, { timezone, now, includeOverdue }) {
  const metrics = emptyMetrics();
  for (const row of rows) {
    const item = presentProductionQueueItem({
      currentPeriodEnd: row.current_period_end || row.currentPeriodEnd,
      productionStatus: row.production_status || row.productionStatus
    }, { timezone, now });
    const bucket = dueBucket(item.daysUntil);
    if (!bucket || !Object.prototype.hasOwnProperty.call(metrics, bucket)) {
      continue;
    }
    if (bucket === 'overdue' && !includeOverdue) {
      continue;
    }
    metrics[bucket] += 1;
  }
  return metrics;
}

class AdminProductionService {
  constructor(options = {}) {
    this.ledgerRepository = options.ledgerRepository;
    this.productionRepository = options.productionRepository;
    this.auditService = options.auditService || null;
    this.now = options.now || (() => new Date());
  }

  present(row, timezone) {
    return presentProductionQueueItem(row, {
      timezone,
      now: this.now()
    });
  }

  async listQueue(query, pagination) {
    const timezone = resolveTimezone(query.timezone);
    const bounds = civilBounds({
      timezone,
      windowDays: query.windowDays,
      now: this.now()
    });
    let account;
    if (query.account) {
      account = parseStripeAccountInput(query.account);
    }

    const listInput = {
      ...bounds,
      includeOverdue: query.includeOverdue !== false,
      account,
      productionStatus: query.productionStatus || undefined,
      q: query.q || undefined,
      offset: pagination.offset,
      perPage: pagination.perPage
    };

    const [result, metricRows] = await Promise.all([
      this.ledgerRepository.listQueue(listInput),
      this.ledgerRepository.listQueueMetricRows({
        ...bounds,
        includeOverdue: query.includeOverdue !== false,
        account
      })
    ]);

    return {
      ...paginatedEnvelope({
        items: result.items.map((item) => this.present(item, timezone)),
        total: result.total,
        page: pagination.page,
        perPage: pagination.perPage
      }),
      metrics: bucketMetrics(metricRows, {
        timezone,
        now: this.now(),
        includeOverdue: query.includeOverdue !== false
      })
    };
  }

  async updateStatus(id, body, actor = {}) {
    const timezone = DEFAULT_TIMEZONE;
    const row = await this.ledgerRepository.findById(id);
    if (!row) {
      throw new HttpError(404, 'Subscription not found.');
    }
    if (!isQueueEligible(row)) {
      throw new HttpError(409, 'Subscription is not eligible for the production queue.', {
        code: 'production_not_eligible'
      });
    }
    if (!periodEndsMatch(body.periodEnd, row.currentPeriodEnd)) {
      throw new HttpError(409, 'Production cycle period end is stale.', {
        code: 'production_period_stale'
      });
    }

    const currentCycle = await this.productionRepository.findBySubscriptionAndPeriodEnd(
      row.id,
      row.currentPeriodEnd
    );
    const fromStatus = currentCycle && currentCycle.status ? currentCycle.status : 'to_prepare';
    const allowed = ALLOWED_TRANSITIONS[fromStatus] || new Set();
    if (!allowed.has(body.status)) {
      throw new HttpError(400, `Cannot transition production status from ${fromStatus} to ${body.status}.`, {
        code: 'invalid_production_transition'
      });
    }

    await this.productionRepository.upsert({
      subscriptionId: row.id,
      periodEnd: row.currentPeriodEnd,
      status: body.status,
      note: body.status === 'blocked' ? body.note : (body.note || null),
      updatedByUserId: actor.userId || (actor.adminIdentity && actor.adminIdentity.userId) || null
    });

    if (this.auditService && typeof this.auditService.record === 'function') {
      await this.auditService.record({
        actor,
        action: 'production.status.update',
        targetUserId: row.userId,
        targetEmail: row.customerEmail,
        metadata: {
          subscriptionId: row.id,
          stripeSubscriptionId: row.stripeSubscriptionId,
          fromStatus,
          toStatus: body.status,
          periodEnd: toMysqlDateTime(row.currentPeriodEnd)
        }
      });
    }

    const updated = await this.ledgerRepository.findQueueRowById(row.id);
    return this.present(updated || { ...row, productionStatus: body.status, note: body.note }, timezone);
  }
}

module.exports = {
  AdminProductionService,
  ALLOWED_TRANSITIONS,
  civilBounds,
  resolveTimezone
};
