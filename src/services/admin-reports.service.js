const { HttpError } = require('../core/http-error');
const { isAdminIdentity, requireSingleReportMarket } = require('../core/admin-market-scope');
const { foldHourlyRows, publicPeriod, resolveReportPeriod } = require('../core/report-period');
const { estimateMrr } = require('../core/report-mrr');
const { formatPackSizeLabel } = require('../core/plan-catalog-pricing');
const { reportFilename, resolveCsvFormat, toReportCsv } = require('../core/report-csv');
const { PRODUCTION_STATUSES } = require('../infrastructure/repositories/admin-reports.repository');

const REPORTS = ['summary', 'revenue', 'subscriptions', 'acquisition', 'mix', 'operations', 'stock'];

// The Stripe account and invoice currency of each market; a report never adds two of them together.
const MARKET_MONEY = {
  BR: { account: 'br', currency: 'brl', code: 'BRL' },
  US: { account: 'us', currency: 'usd', code: 'USD' }
};

function kpi(value, previous) {
  return { value, previous };
}

function ratio(numerator, denominator) {
  return denominator ? Math.round((numerator / denominator) * 10000) / 10000 : null;
}

function average(total, count) {
  return count ? Math.round(total / count) : null;
}

// A recipe without a catalog name in the market is a catalog error: show its key and flag it, never hide it.
function recipeName(names, key) {
  const label = names[key] && names[key].label;
  return label ? { name: label, nameMissing: false } : { name: key, nameMissing: true };
}

// US sizes are sold in ounces; the grams stay beside them so two sizes with the same rounded ounces stay apart.
function packLabel(grams, market) {
  const label = formatPackSizeLabel(grams, market);
  return market === 'US' ? `${label} (${Math.round(Number(grams || 0))} g)` : label;
}

function toMysql(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

// Read-only aggregates for the admin Reports page, one market at a time (the summary puts markets side by side).
class AdminReportsService {
  constructor(options = {}) {
    this.repository = options.repository;
    this.recipeNamesRepository = options.recipeNamesRepository || null;
    this.logger = options.logger || null;
    this.now = options.now || (() => new Date());
  }

  context(market, query, actor = {}) {
    const now = this.now();
    return {
      market,
      actor,
      money: MARKET_MONEY[market],
      period: resolveReportPeriod(query, { market, now }),
      now
    };
  }

  envelope(ctx, body) {
    return {
      market: ctx.market,
      currency: ctx.money.code,
      period: publicPeriod(ctx.period),
      generatedAt: new Date(ctx.now).toISOString(),
      ...body
    };
  }

  async report(name, query = {}, marketQuery = {}, actor = {}) {
    if (!REPORTS.includes(name)) {
      throw new HttpError(400, 'Unknown report.', { code: 'report_unknown' });
    }
    if (name === 'summary') {
      return this.summary(query, marketQuery);
    }
    const ctx = this.context(requireSingleReportMarket(marketQuery), query, actor);
    return this[name](ctx);
  }

  async revenueFigures(ctx, range) {
    const { account, currency } = ctx.money;
    const totals = await this.repository.invoiceTotals({ account, currency, range });
    if (totals.excludedInvoices > 0 && this.logger && typeof this.logger.warn === 'function') {
      this.logger.warn({ account, currency, range, excludedInvoices: totals.excludedInvoices }, 'Paid invoices in another currency were left out of a report.');
    }
    return totals;
  }

  async revenue(ctx) {
    const { account, currency } = ctx.money;
    const [current, previous, hourly, prices] = await Promise.all([
      this.revenueFigures(ctx, ctx.period.range),
      this.revenueFigures(ctx, ctx.period.previousRange),
      this.repository.invoiceSeries({ account, currency, range: ctx.period.range }),
      this.repository.recurringPrices({ account })
    ]);
    return this.envelope(ctx, {
      kpis: {
        grossRevenue: kpi(current.revenue, previous.revenue),
        paidInvoices: kpi(current.invoices, previous.invoices),
        averageTicket: kpi(average(current.revenue, current.invoices), average(previous.revenue, previous.invoices)),
        firstPurchaseRevenue: kpi(current.firstPurchaseRevenue, previous.firstPurchaseRevenue),
        renewalRevenue: kpi(current.revenue - current.firstPurchaseRevenue, previous.revenue - previous.firstPurchaseRevenue)
      },
      estimatedMrr: estimateMrr(prices),
      excludedInvoices: current.excludedInvoices,
      series: foldHourlyRows(hourly, ctx.period, ['revenue', 'invoices'])
    });
  }

  async subscriptions(ctx) {
    const { account } = ctx.money;
    const in7d = new Date(new Date(ctx.now).getTime() + 7 * 24 * 60 * 60 * 1000);
    const [snapshot, current, previous, hourly] = await Promise.all([
      this.repository.subscriptionSnapshot({ account, now: toMysql(ctx.now), in7d: toMysql(in7d) }),
      this.repository.subscriptionPeriod({ account, range: ctx.period.range }),
      this.repository.subscriptionPeriod({ account, range: ctx.period.previousRange }),
      this.repository.subscriptionSeries({ account, range: ctx.period.range })
    ]);
    return this.envelope(ctx, {
      current: Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, kpi(value, null)])),
      kpis: {
        new: kpi(current.newCount, previous.newCount),
        canceled: kpi(current.canceled, previous.canceled),
        activeAtStart: kpi(current.activeAtStart, previous.activeAtStart),
        churn: kpi(ratio(current.churned, current.activeAtStart), ratio(previous.churned, previous.activeAtStart))
      },
      approximateNewCount: current.approximateNew,
      approximateCanceledCount: current.approximateCanceled,
      series: foldHourlyRows(hourly, ctx.period, ['newCount', 'canceled'])
    });
  }

  async acquisitionFigures(ctx, range) {
    return this.repository.acquisitionTotals({ market: ctx.market, account: ctx.money.account, range });
  }

  async acquisition(ctx) {
    const admin = isAdminIdentity(ctx.actor);
    const [current, previous, hourly, unassigned] = await Promise.all([
      this.acquisitionFigures(ctx, ctx.period.range),
      this.acquisitionFigures(ctx, ctx.period.previousRange),
      this.repository.acquisitionSeries({ market: ctx.market, range: ctx.period.range }),
      admin ? this.repository.unassignedCheckouts({ range: ctx.period.range }) : null
    ]);
    return this.envelope(ctx, {
      ...(admin ? { unassignedCheckouts: unassigned } : {}),
      stages: {
        started: kpi(current.started, previous.started),
        linked: kpi(current.linked, previous.linked),
        activated: kpi(current.activated, previous.activated)
      },
      conversions: {
        startedToLinked: kpi(ratio(current.linked, current.started), ratio(previous.linked, previous.started)),
        linkedToActivated: kpi(ratio(current.activated, current.linked), ratio(previous.activated, previous.linked)),
        startedToActivated: kpi(ratio(current.activated, current.started), ratio(previous.activated, previous.started))
      },
      series: foldHourlyRows(hourly, ctx.period, ['started'])
    });
  }

  async recipeNames(market) {
    const repository = this.recipeNamesRepository;
    if (!repository || typeof repository.listRecipeNames !== 'function') {
      return {};
    }
    try {
      return (await repository.listRecipeNames())[market] || {};
    } catch (_error) {
      return {};
    }
  }

  async mix(ctx) {
    const { account } = ctx.money;
    const [recipes, sizes, names] = await Promise.all([
      this.repository.mixByRecipe({ account }),
      this.repository.mixByPackSize({ account }),
      this.recipeNames(ctx.market)
    ]);
    const totalPacks = sizes.reduce((sum, row) => sum + Number(row.packs || 0), 0);
    return {
      ...this.envelope(ctx, {}),
      period: null,
      recipes: recipes.map((row) => ({
        key: row.flavor,
        ...recipeName(names, row.flavor),
        packs: Number(row.packs || 0),
        subscriptions: Number(row.subscriptions || 0)
      })),
      packSizes: sizes.map((row) => ({
        grams: Number(row.grams || 0),
        label: packLabel(row.grams, ctx.market),
        packs: Number(row.packs || 0),
        subscriptions: Number(row.subscriptions || 0),
        share: ratio(Number(row.packs || 0), totalPacks)
      }))
    };
  }

  async shipments(ctx) {
    if (ctx.market !== 'US') {
      return null;
    }
    const count = async (range) => {
      const rows = await this.repository.shipmentsByStatus({ account: ctx.money.account, range });
      const byStatus = {};
      for (const row of rows) {
        byStatus[row.status] = Number(row.shipments || 0);
      }
      const total = Object.entries(byStatus).reduce((sum, [status, value]) => (status === 'voided' ? sum : sum + value), 0);
      return { byStatus, total };
    };
    const [current, previous] = await Promise.all([count(ctx.period.range), count(ctx.period.previousRange)]);
    const statuses = [...new Set([...Object.keys(current.byStatus), ...Object.keys(previous.byStatus)])].sort();
    return {
      total: kpi(current.total, previous.total),
      byStatus: Object.fromEntries(statuses.map((status) => [status, kpi(current.byStatus[status] || 0, previous.byStatus[status] || 0)]))
    };
  }

  async operations(ctx) {
    const { account } = ctx.money;
    const today = ctx.period.today;
    const [current, previous, awaiting, shipments] = await Promise.all([
      this.repository.cyclesByStatus({ account, from: ctx.period.from, to: ctx.period.to, today }),
      this.repository.cyclesByStatus({ account, from: ctx.period.previous.from, to: ctx.period.previous.to, today }),
      this.repository.awaitingPayment({ account }),
      this.shipments(ctx)
    ]);
    return this.envelope(ctx, {
      cycles: Object.fromEntries(PRODUCTION_STATUSES.map((status) => [status, kpi(current.byStatus[status], previous.byStatus[status])])),
      late: kpi(current.late, previous.late),
      awaitingPayment: kpi(awaiting, null),
      shipments
    });
  }

  async stock(ctx) {
    const [current, previous, names] = await Promise.all([
      this.repository.stockRows({ market: ctx.market, range: ctx.period.range }),
      this.repository.stockRows({ market: ctx.market, range: ctx.period.previousRange }),
      this.recipeNames(ctx.market)
    ]);
    const rows = current.map((row) => ({
      key: row.flavorKey,
      ...recipeName(names, row.flavorKey),
      grams: Number(row.grams || 0),
      label: packLabel(row.grams, ctx.market),
      produced: Number(row.produced || 0),
      separated: Number(row.separated || 0),
      adjusted: Number(row.adjusted || 0),
      onHand: Number(row.onHand || 0),
      minLevel: row.minLevel == null ? null : Number(row.minLevel)
    }));
    const sum = (list, key) => list.reduce((total, row) => total + Number(row[key] || 0), 0);
    return this.envelope(ctx, {
      rows,
      totals: {
        produced: kpi(sum(rows, 'produced'), sum(previous, 'produced')),
        separated: kpi(sum(rows, 'separated'), sum(previous, 'separated')),
        adjusted: kpi(sum(rows, 'adjusted'), sum(previous, 'adjusted')),
        onHand: kpi(sum(rows, 'onHand'), null)
      }
    });
  }

  async summaryBlock(market, query) {
    const ctx = this.context(market, query);
    const { account } = ctx.money;
    const [revenue, previousRevenue, period, previousPeriod, snapshot, acquisition, previousAcquisition] = await Promise.all([
      this.revenueFigures(ctx, ctx.period.range),
      this.revenueFigures(ctx, ctx.period.previousRange),
      this.repository.subscriptionPeriod({ account, range: ctx.period.range }),
      this.repository.subscriptionPeriod({ account, range: ctx.period.previousRange }),
      this.repository.subscriptionSnapshot({ account, now: toMysql(ctx.now), in7d: toMysql(ctx.now) }),
      this.acquisitionFigures(ctx, ctx.period.range),
      this.acquisitionFigures(ctx, ctx.period.previousRange)
    ]);
    return {
      market,
      currency: ctx.money.code,
      period: publicPeriod(ctx.period),
      kpis: {
        grossRevenue: kpi(revenue.revenue, previousRevenue.revenue),
        paidInvoices: kpi(revenue.invoices, previousRevenue.invoices),
        averageTicket: kpi(average(revenue.revenue, revenue.invoices), average(previousRevenue.revenue, previousRevenue.invoices)),
        activeSubscriptions: kpi(snapshot.active + snapshot.trialing, null),
        new: kpi(period.newCount, previousPeriod.newCount),
        canceled: kpi(period.canceled, previousPeriod.canceled),
        churn: kpi(ratio(period.churned, period.activeAtStart), ratio(previousPeriod.churned, previousPeriod.activeAtStart)),
        checkoutsStarted: kpi(acquisition.started, previousAcquisition.started),
        checkoutToActivation: kpi(ratio(acquisition.activated, acquisition.started), ratio(previousAcquisition.activated, previousAcquisition.started))
      }
    };
  }

  // Same figures as the JSON report. The file is named after the requested window even for the mix,
  // which ignores it, so a download always says when it was taken.
  async exportCsv(query = {}, marketQuery = {}, actor = {}) {
    const name = String(query.report || '');
    if (!REPORTS.includes(name)) {
      throw new HttpError(400, 'Unknown report.', { code: 'report_unknown' });
    }
    const format = resolveCsvFormat(query.formato);
    const report = await this.report(name, query, marketQuery, actor);
    let market;
    let window;
    if (name === 'summary') {
      market = report.markets.length === 1 ? report.markets[0].market : 'all';
      window = report.period || {};
    } else {
      market = report.market;
      window = report.period || publicPeriod(resolveReportPeriod(query, { market, now: this.now() }));
    }
    return {
      csv: toReportCsv(name, report, format),
      filename: reportFilename(name, market, window.from, window.to)
    };
  }

  async summary(query, marketQuery) {
    const markets = (Array.isArray(marketQuery.markets) ? marketQuery.markets : []).filter((market) => MARKET_MONEY[market]);
    const blocks = await Promise.all(markets.map((market) => this.summaryBlock(market, query)));
    const first = blocks[0];
    return {
      period: first ? { from: first.period.from, to: first.period.to, previous: first.period.previous } : null,
      generatedAt: new Date(this.now()).toISOString(),
      markets: blocks
    };
  }
}

module.exports = {
  AdminReportsService,
  MARKET_MONEY,
  REPORTS
};
