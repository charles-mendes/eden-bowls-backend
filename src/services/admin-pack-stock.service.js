const { DateTime } = require('luxon');
const { HttpError } = require('../core/http-error');
const { paginatedEnvelope } = require('../api/validators/admin-pagination');
const { constrainMarketQuery, marketFromStripeAccount } = require('../core/admin-market-scope');
const { stripeAccountFromMarket } = require('../core/stripe-account');
const { flavorKeyFromLabel } = require('../core/flavors');
const { DEFAULT_TIMEZONE, presentProductionQueueItem } = require('../core/production-queue-presenter');
const { allocateCoverage, buildOverview, cyclePacks } = require('../core/pack-stock');
const { measureStockComputation } = require('../core/stock-metrics');

function emptyStock() {
  return { shortages: [], unsized: 0 };
}

function windowBounds({ timezone, windowDays, now }) {
  const today = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  return {
    startOfToday: today.toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
    windowEndExclusive: today.plus({ days: windowDays }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss'),
    overdueFloor: today.minus({ days: windowDays }).toUTC().toFormat('yyyy-MM-dd HH:mm:ss')
  };
}

function actorUserId(actor = {}) {
  return actor.userId || (actor.adminIdentity && actor.adminIdentity.userId) || null;
}

// A queue row as the stock math sees it: the presenter's line items, keyed like the queue item.
function cycleFromQueueRow(row, { timezone, now }) {
  const item = presentProductionQueueItem(row, { timezone, now });
  return {
    key: `${item.id}|${item.currentPeriodEnd}`,
    subscriptionId: item.id,
    periodEnd: item.currentPeriodEnd,
    dueAt: row.dueAt || item.currentPeriodEnd,
    productionStatus: item.productionStatus,
    paymentState: item.paymentState,
    market: marketFromStripeAccount(item.stripeAccount),
    lineItems: item.lineItems
  };
}

class AdminPackStockService {
  constructor(options = {}) {
    this.stockRepository = options.stockRepository;
    this.ledgerRepository = options.ledgerRepository || null;
    this.catalogRepository = options.catalogRepository || null;
    this.auditService = options.auditService || null;
    this.logger = options.logger || null;
    this.now = options.now || (() => new Date());
  }

  // One market per call. Someone who sees both markets has to name it.
  resolveMarket(actor, market) {
    const scoped = constrainMarketQuery(actor || {}, { market });
    if (scoped.markets.length !== 1) {
      throw new HttpError(400, 'market is required.', { code: 'stock_market_required' });
    }
    return scoped.markets[0];
  }

  async isAvailable() {
    return Boolean(this.stockRepository) && this.stockRepository.isAvailable();
  }

  transaction(work) {
    return this.stockRepository.transaction(work);
  }

  warnUnsized(lines, context = {}) {
    if (!this.logger || typeof this.logger.warn !== 'function') {
      return;
    }
    for (const line of lines) {
      this.logger.warn({
        event: 'stock.unsized_line',
        subscriptionId: line.subscriptionId,
        productionCycleId: context.productionCycleId || null,
        periodEnd: line.periodEnd || null,
        label: line.label
      }, 'stock.unsized_line');
    }
  }

  async loadCycles({ markets, windowDays, timezone = DEFAULT_TIMEZONE }) {
    const now = this.now();
    const rows = await this.ledgerRepository.listQueueDemandRows({
      ...windowBounds({ timezone, windowDays, now }),
      includeOverdue: true,
      stripeAccounts: markets.map((market) => stripeAccountFromMarket(market))
    });
    return rows.map((row) => cycleFromQueueRow(row, { timezone, now }));
  }

  async overview(query = {}, actor = {}) {
    const market = this.resolveMarket(actor, query.market);
    const windowDays = query.windowDays || 7;
    const { overview } = await measureStockComputation('overview', async () => {
      const [stockItems, cycles] = await Promise.all([
        this.stockRepository.listItems(market),
        this.loadCycles({ markets: [market], windowDays })
      ]);
      return { overview: buildOverview({ stockItems, cycles }), rowCount: cycles.length };
    });
    this.warnUnsized(overview.unsizedLines);
    return { market, windowDays, ...overview };
  }

  // Coverage of every committing cycle in the queue window, per market, or null without stock storage.
  async queueCoverage({ markets, windowDays, timezone }) {
    if (!(await this.isAvailable())) {
      return null;
    }
    const { coverage } = await measureStockComputation('queue', async () => {
      const [cycles, ...stockByMarket] = await Promise.all([
        this.loadCycles({ markets, windowDays, timezone }),
        ...markets.map((market) => this.stockRepository.listItems(market))
      ]);
      const coverage = new Map();
      markets.forEach((market, index) => {
        const marketCycles = cycles.filter((cycle) => cycle.market === market);
        for (const [key, value] of allocateCoverage({ stockItems: stockByMarket[index], cycles: marketCycles })) {
          coverage.set(key, value);
        }
      });
      return { coverage, rowCount: cycles.length };
    });
    return coverage;
  }

  async listMovements(query = {}, pagination = { page: 1, perPage: 20, offset: 0 }, actor = {}) {
    const market = this.resolveMarket(actor, query.market);
    const result = await this.stockRepository.listMovements({
      market,
      flavorKey: query.flavorKey ? flavorKeyFromLabel(query.flavorKey) : undefined,
      packSizeGrams: query.packSizeGrams || undefined,
      type: query.type || undefined
    }, pagination);
    return paginatedEnvelope({ items: result.items, total: result.total, page: pagination.page, perPage: pagination.perPage });
  }

  // The item exists, or the market's catalog has (or had) a variation with that recipe and grams.
  async resolveItemKey(body, actor) {
    const market = this.resolveMarket(actor, body.market);
    const key = { market, flavorKey: flavorKeyFromLabel(body.flavorKey), packSizeGrams: Number(body.packSizeGrams) };
    if (await this.stockRepository.findItem(key)) {
      return key;
    }
    const sizes = this.catalogRepository && typeof this.catalogRepository.listRecipeSizes === 'function'
      ? await this.catalogRepository.listRecipeSizes(market)
      : new Set();
    if (!sizes.has(`${key.flavorKey}|${key.packSizeGrams}`)) {
      throw new HttpError(422, 'This recipe and pack size are not sold in this market.', { code: 'stock_item_unknown' });
    }
    return key;
  }

  async audit(actor, action, metadata) {
    if (this.auditService && typeof this.auditService.record === 'function') {
      await this.auditService.record({ actor, action, targetUserId: null, targetEmail: null, metadata });
    }
  }

  async writeMovement(body, actor, movement, action) {
    const key = await this.resolveItemKey(body, actor);
    const [item] = await this.stockRepository.transaction((manager) => this.stockRepository.applyMovements(manager, [{
      ...key,
      ...movement,
      actorUserId: actorUserId(actor)
    }]));
    await this.audit(actor, action, { ...key, quantity: movement.quantity, reason: movement.reason || null, note: movement.note || null });
    return item;
  }

  recordProduction(body, actor = {}) {
    return this.writeMovement(body, actor, { type: 'production', quantity: body.quantity, note: body.note || null }, 'stock.production');
  }

  recordAdjustment(body, actor = {}) {
    return this.writeMovement(body, actor, {
      type: 'adjustment',
      quantity: body.quantity,
      reason: body.reason,
      note: body.note || null
    }, 'stock.adjustment');
  }

  async setMinimum(body, actor = {}) {
    const key = await this.resolveItemKey(body, actor);
    const item = await this.stockRepository.setMinimum({ ...key, minLevel: body.minLevel });
    await this.audit(actor, 'stock.minimum.update', { ...key, minLevel: body.minLevel });
    return item;
  }

  // Inside the production status transaction: `separate` deducts the cycle packs once, `reverse` gives back
  // exactly what its open separation took.
  async applyCycleMove(manager, { move, productionCycleId, subscriptionId, market, lineItems, actor }) {
    const open = await this.stockRepository.openSeparationsForCycle(manager, productionCycleId);
    const base = { productionCycleId, subscriptionId, actorUserId: actorUserId(actor) };

    if (move === 'reverse') {
      if (open.length) {
        await this.stockRepository.applyMovements(manager, open.map((entry) => ({
          ...entry,
          ...base,
          type: 'separation_reversal',
          quantity: -entry.quantity
        })));
      }
      return emptyStock();
    }

    if (open.length) {
      return emptyStock();
    }
    const { packs, unsized } = cyclePacks({ subscriptionId, lineItems });
    this.warnUnsized(unsized, { productionCycleId });
    const touched = packs.length
      ? await this.stockRepository.applyMovements(manager, packs.map((pack) => ({
        market,
        flavorKey: pack.flavorKey,
        packSizeGrams: pack.packSizeGrams,
        ...base,
        type: 'separation',
        quantity: -pack.quantity
      })))
      : [];
    return {
      shortages: touched
        .filter((item) => item.onHand < 0)
        .map((item) => ({ flavorKey: item.flavorKey, packSizeGrams: item.packSizeGrams, onHand: item.onHand })),
      unsized: unsized.length
    };
  }
}

module.exports = {
  AdminPackStockService,
  emptyStock
};
