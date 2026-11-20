const { toReportCsv } = require('../src/core/report-csv');
const { hasPrevious, resolveIndicator } = require('../src/core/report-indicators');

const period = { from: '2026-10-20', to: '2026-10-21', timezone: 'America/New_York', granularity: 'day', partialToday: false, previous: { from: '2026-10-18', to: '2026-10-19' } };
const base = { market: 'US', currency: 'USD', period, generatedAt: '2026-10-22T12:00:00.000Z' };
const kpi = (value, previous = null) => ({ value, previous });
const bucket = (values) => ({ key: '2026-10-20', from: '2026-10-20', to: '2026-10-20', partial: false, ...values });

const REPORTS = {
  summary: {
    period,
    generatedAt: base.generatedAt,
    markets: [{
      market: 'US',
      currency: 'USD',
      period,
      kpis: Object.fromEntries(['grossRevenue', 'paidInvoices', 'averageTicket', 'activeSubscriptions', 'new', 'canceled', 'churn', 'checkoutsStarted', 'checkoutToActivation'].map((key) => [key, kpi(1, 1)]))
    }]
  },
  revenue: {
    ...base,
    kpis: { grossRevenue: kpi(100, 50), paidInvoices: kpi(1, 1), averageTicket: kpi(100, 50), firstPurchaseRevenue: kpi(100, 0), renewalRevenue: kpi(0, 50) },
    estimatedMrr: { value: 100, previous: null, estimated: true, trialingSubscriptions: 1, unpricedSubscriptions: 0 },
    excludedInvoices: 1,
    series: [bucket({ revenue: 100, invoices: 1 })]
  },
  subscriptions: {
    ...base,
    current: { active: kpi(1), trialing: kpi(1), canceling: kpi(0), pastDue: kpi(0), renewing7d: kpi(0) },
    kpis: { new: kpi(1, 0), canceled: kpi(0, 0), activeAtStart: kpi(1, 1), churn: kpi(0, 0) },
    approximateNewCount: 0,
    approximateCanceledCount: 0,
    series: [bucket({ newCount: 1, canceled: 0 })]
  },
  acquisition: {
    ...base,
    unassignedCheckouts: 1,
    stages: { started: kpi(2, 1), linked: kpi(1, 1), activated: kpi(1, 0) },
    conversions: { startedToLinked: kpi(0.5, 1), linkedToActivated: kpi(1, 0), startedToActivated: kpi(0.5, 0) },
    series: [bucket({ started: 2 })]
  },
  mix: {
    market: 'US', currency: 'USD', period: null, generatedAt: base.generatedAt,
    recipes: [{ key: 'beef', name: 'Beef', nameMissing: false, packs: 3, subscriptions: 2 }],
    packSizes: [{ grams: 499, label: '17.6 oz (499 g)', packs: 3, subscriptions: 2, share: 1 }]
  },
  operations: {
    ...base,
    cycles: { to_prepare: kpi(1, 0), in_production: kpi(0, 0), ready: kpi(0, 1), blocked: kpi(0, 0) },
    late: kpi(0, 0),
    awaitingPayment: kpi(1),
    shipments: { total: kpi(1, 0), byStatus: { delivered: kpi(1, 0), voided: kpi(1, 0) } }
  },
  stock: {
    ...base,
    rows: [{ key: 'beef', name: 'Beef', nameMissing: false, grams: 499, label: '17.6 oz (499 g)', produced: 1, separated: 0, adjusted: 0, onHand: 1, minLevel: 2 }],
    totals: { produced: kpi(1, 0), separated: kpi(0, 0), adjusted: kpi(0, 0), onHand: kpi(1) }
  }
};

// Rows that describe the export, not a figure: the header block and the "nothing here" placeholders.
const NOT_A_FIGURE = new Set(['market', 'currency', 'period', 'period.previous', 'period.timezone', 'period.granularity', 'generatedAt', 'markets', 'recipes', 'packSizes', 'rows', 'shipments.byStatus']);

function csvKeys(name) {
  return toReportCsv(name, REPORTS[name], 'csv').trim().split('\r\n').slice(1)
    .map((line) => line.slice(line.lastIndexOf(',"') + 2, -1))
    .filter((key) => !NOT_A_FIGURE.has(key));
}

describe('report indicator catalog', () => {
  test.each(Object.keys(REPORTS))('every figure of the %s CSV opens in the catalog with a value from the report', (name) => {
    const keys = csvKeys(name);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const entry = resolveIndicator(name, key);
      const report = name === 'summary' ? null : REPORTS[name];
      expect(entry.label).toBeTruthy();
      expect(entry.description).toBeTruthy();
      expect(['money', 'count', 'rate']).toContain(entry.kind);
      expect(entry.source || entry.mrr || entry.config).toBeTruthy();
      if (report) {
        expect(entry.value(report, {})).not.toBeUndefined();
      }
    }
  });

  test('summary cards point at the figure of the market report', () => {
    expect(resolveIndicator('summary', 'checkoutToActivation')).toMatchObject({ report: 'acquisition', key: 'conversions.startedToActivated', label: 'Checkout → ativação' });
    const active = resolveIndicator('summary', 'activeSubscriptions');
    expect(active).toMatchObject({ report: 'subscriptions', key: 'activeSubscriptions' });
    expect(active.value(REPORTS.subscriptions)).toBe(2);
  });

  test('the CSV total row of a series opens the series of the whole period', () => {
    const entry = resolveIndicator('revenue', 'series.revenue.total');
    expect(entry.key).toBe('series.revenue');
    expect(entry.value(REPORTS.revenue, {})).toBe(100);
    expect(entry.value(REPORTS.revenue, { bucket: { revenue: 40 } })).toBe(40);
  });

  test('point-in-time figures, series and controls have no previous period', () => {
    expect(hasPrevious(resolveIndicator('revenue', 'grossRevenue'))).toBe(true);
    expect(hasPrevious(resolveIndicator('subscriptions', 'current.active'))).toBe(false);
    expect(hasPrevious(resolveIndicator('revenue', 'series.revenue'))).toBe(false);
    expect(hasPrevious(resolveIndicator('stock', 'rows.beef.499.produced'))).toBe(false);
    expect(hasPrevious(resolveIndicator('mix', 'recipes.beef.packs'))).toBe(false);
  });

  test('a dynamic key that is not in the report has no value', () => {
    expect(resolveIndicator('mix', 'recipes.fish.packs').value(REPORTS.mix)).toBeUndefined();
    expect(resolveIndicator('stock', 'rows.beef.300.onHand').value(REPORTS.stock)).toBeUndefined();
  });

  test('an unknown key or report is rejected', () => {
    expect(() => resolveIndicator('revenue', 'customers')).toThrow(expect.objectContaining({ statusCode: 400, details: { code: 'report_indicator_unknown' } }));
    expect(() => resolveIndicator('summary', 'excludedInvoices')).toThrow(expect.objectContaining({ details: { code: 'report_indicator_unknown' } }));
    expect(() => resolveIndicator('customers', 'grossRevenue')).toThrow(expect.objectContaining({ details: { code: 'report_unknown' } }));
  });
});
