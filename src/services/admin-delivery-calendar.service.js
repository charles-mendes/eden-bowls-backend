const { HttpError } = require('../core/http-error');
const { MOVES } = require('./delivery-calendar-impact.service');
const {
  assertNoTwin,
  changedRow,
  newRow,
  rowsWith,
  shortNotice,
  turnsFlagOn
} = require('../core/delivery-calendar-change');

const MARKETS = ['BR', 'US'];

function parseYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new HttpError(422, 'Ano inválido.', { code: 'invalid_year' });
  }
  return year;
}

// One market per request: the panel always edits a single market's calendar.
function singleMarket(marketQuery) {
  const market = marketQuery && marketQuery.market;
  if (!MARKETS.includes(market)) {
    throw new HttpError(422, 'Informe o mercado (BR ou US).', { code: 'market_required' });
  }
  return market;
}

const AUDIT_FLAGS = ['active', 'closesPreparation', 'closesPickup', 'closesDelivery'];

function auditValues(row) {
  if (!row) return null;
  return Object.fromEntries(AUDIT_FLAGS.map((flag) => [flag, Boolean(row[flag])]));
}

function auditAction(before, after) {
  if (!before) return 'delivery_calendar.create';
  if (!after) return 'delivery_calendar.remove';
  if (Boolean(before.active) !== Boolean(after.active)) {
    return after.active ? 'delivery_calendar.activate' : 'delivery_calendar.deactivate';
  }
  return 'delivery_calendar.update';
}

function movedForAudit(affected) {
  return affected.map((item) => ({
    stripeSubscriptionId: item.stripeSubscriptionId,
    deliveryId: item.deliveryId,
    previousPreparationDay: item.preparationDay,
    newPreparationDay: item.newPreparationDay,
    move: item.move,
    ...(item.pendingTrialEnd ? { pendingTrialEnd: item.pendingTrialEnd } : {})
  }));
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(422, 'Linha inválida.', { code: 'invalid_id' });
  }
  return id;
}

class AdminDeliveryCalendarService {
  constructor(options = {}) {
    this.calendarRepository = options.calendarRepository;
    this.impactService = options.impactService || null;
    this.syncsRepository = options.syncsRepository || null;
    this.ledgerRepository = options.ledgerRepository || null;
    this.auditRepository = options.auditRepository || null;
    this.dataSource = options.dataSource || null;
    this.now = options.now || (() => new Date());
  }

  transaction(work) {
    if (!this.dataSource || typeof this.dataSource.transaction !== 'function') {
      throw new HttpError(503, 'Delivery calendar writes are not available.');
    }
    return this.dataSource.transaction(work);
  }

  // The row before and after a change: an existing row by id, or a new row from the body.
  async resolveChange(market, body = {}, executor) {
    if (body.id != null) {
      const existing = await this.calendarRepository.findById(parseId(body.id), executor);
      if (!existing) {
        throw new HttpError(404, 'Linha não encontrada.', { code: 'not_found' });
      }
      if (existing.market !== market) {
        throw new HttpError(403, 'Requested market is outside staff scope.', { code: 'market_forbidden' });
      }
      return { before: existing, after: changedRow(existing, body) };
    }
    const after = newRow(market, body);
    const sameYear = await this.calendarRepository.listYear(market, Number(after.closedOn.slice(0, 4)), executor);
    assertNoTwin(sameYear, after);
    return { before: null, after };
  }

  async affectedBy(market, before, after, executor) {
    if (!turnsFlagOn(before, after)) return [];
    if (!this.impactService) {
      throw new HttpError(503, 'Delivery calendar impact is not available.');
    }
    const active = (await this.calendarRepository.listActive(executor)).filter((item) => item.market === market);
    return this.impactService.assess({ market, rowsBefore: active, rowsAfter: rowsWith(active, after) });
  }

  // What a change would do, without storing anything.
  async preview({ marketQuery, body }) {
    const market = singleMarket(marketQuery);
    const { before, after } = await this.resolveChange(market, body);
    const affected = await this.affectedBy(market, before, after);
    return {
      market,
      change: after,
      affected,
      shortNotice: shortNotice(market, after.closedOn, this.now())
    };
  }

  async history({ marketQuery, year }) {
    const market = singleMarket(marketQuery);
    const parsedYear = parseYear(year);
    if (!this.auditRepository || typeof this.auditRepository.listDeliveryCalendar !== 'function') {
      throw new HttpError(503, 'Delivery calendar history is not available.');
    }
    const items = await this.auditRepository.listDeliveryCalendar({ market, year: parsedYear });
    return { market, year: parsedYear, items };
  }

  async listYear({ marketQuery, year }) {
    const market = singleMarket(marketQuery);
    const parsedYear = parseYear(year);
    const items = await this.calendarRepository.listYear(market, parsedYear);
    return { market, year: parsedYear, items };
  }

  // Create, flag change, activation, or deactivation. A write that closes a flag projects again inside the
  // transaction, refuses over a locked delivery, and queues what has to move; it never calls Stripe.
  async recordAudit(manager, identity, { before, after, affected = [], syncIds = [] }) {
    if (!this.auditRepository || typeof this.auditRepository.createIn !== 'function') {
      throw new HttpError(503, 'Delivery calendar audit is not available.');
    }
    const row = after || before;
    const eventId = await this.auditRepository.createIn(manager, {
      actorUserId: identity && identity.userId,
      actorEmail: identity && identity.email,
      action: auditAction(before, after),
      metadata: {
        market: row.market,
        closedOn: row.closedOn,
        type: row.type,
        label: row.label,
        before: auditValues(before),
        after: auditValues(after),
        moved: movedForAudit(affected),
        syncIds
      }
    });
    if (syncIds.length > 0) {
      await this.syncsRepository.linkAuditEvent(manager, syncIds, eventId);
    }
    return eventId;
  }

  async write({ marketQuery, body, identity }) {
    const market = singleMarket(marketQuery);
    return this.transaction(async (manager) => {
      const { before, after } = await this.resolveChange(market, body, manager);
      const affected = await this.affectedBy(market, before, after, manager);
      const locked = affected.filter((item) => item.locked);
      if (locked.length > 0) {
        throw new HttpError(409, 'Há entregas travadas nessa data. Resolva-as antes de fechar o dia.', {
          code: 'delivery_locked',
          subscriptions: locked.map((item) => ({
            stripeSubscriptionId: item.stripeSubscriptionId,
            deliveryId: item.deliveryId,
            lockReason: item.lockReason
          }))
        });
      }
      const row = await this.storeRow(manager, before, after);
      const syncIds = await this.queueMoves(manager, market, affected);
      const auditEventId = await this.recordAudit(manager, identity, { before, after: row, affected, syncIds });
      return { market, row, before, affected, syncIds, auditEventId };
    });
  }

  async storeRow(manager, before, after) {
    if (before) return this.calendarRepository.updateRow(manager, after);
    try {
      return await this.calendarRepository.insertRow(manager, after);
    } catch (error) {
      const code = error && (error.code || (error.driverError && error.driverError.code));
      if (code === 'ER_DUP_ENTRY') {
        throw new HttpError(409, 'Já existe uma linha desse tipo nessa data.', { code: 'closed_day_conflict' });
      }
      throw error;
    }
  }

  async queueMoves(manager, market, affected) {
    const syncIds = [];
    for (const item of affected) {
      if (item.move === MOVES.STRIPE_SYNC) {
        syncIds.push(await this.syncsRepository.insertPending(manager, {
          stripeSubscriptionId: item.stripeSubscriptionId,
          market,
          expectedTrialEnd: item.expectedTrialEnd,
          targetTrialEnd: item.targetTrialEnd
        }));
      } else if (item.move === MOVES.PENDING_CHANGE) {
        await this.ledgerRepository.rewritePendingChargeMove(manager, item.stripeSubscriptionId, {
          previous: Math.floor(Date.parse(item.pendingTrialEnd.previous) / 1000),
          next: Math.floor(Date.parse(item.pendingTrialEnd.next) / 1000)
        });
      }
    }
    return syncIds;
  }

  // Removal only opens the date: scheduled deliveries, stored trial_end values, and syncs stay as they are.
  async remove({ marketQuery, id, identity }) {
    const market = singleMarket(marketQuery);
    return this.transaction(async (manager) => {
      const existing = await this.calendarRepository.findById(parseId(id), manager);
      if (!existing) {
        throw new HttpError(404, 'Linha não encontrada.', { code: 'not_found' });
      }
      if (existing.market !== market) {
        throw new HttpError(403, 'Requested market is outside staff scope.', { code: 'market_forbidden' });
      }
      if (existing.type === 'national') {
        throw new HttpError(422, 'Feriado nacional não pode ser removido. Desative-o.', { code: 'national_not_removable' });
      }
      // The event goes first, so the removed date stays traceable once the row is gone.
      const auditEventId = await this.recordAudit(manager, identity, { before: existing, after: null });
      await this.calendarRepository.deleteRow(manager, existing.id);
      return { market, removed: existing, auditEventId };
    });
  }
}

module.exports = {
  AdminDeliveryCalendarService,
  parseYear,
  singleMarket
};
