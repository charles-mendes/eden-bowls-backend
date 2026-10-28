const { AdminReportsService } = require('../src/services/admin-reports.service');

// 2026-10-28 15:00 in Sao Paulo.
const NOW = new Date('2026-10-28T18:00:00Z');
const BR = { markets: ['BR'] };
const US = { markets: ['US'] };
const BOTH = { markets: ['BR', 'US'] };

function fakeRepository(overrides = {}) {
  const zeroInvoices = { revenue: 0, invoices: 0, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 };
  const zeroPeriod = { newCount: 0, approximateNew: 0, canceled: 0, approximateCanceled: 0, activeAtStart: 0, churned: 0 };
  return {
    invoiceTotals: jest.fn().mockResolvedValue(zeroInvoices),
    invoiceSeries: jest.fn().mockResolvedValue([]),
    recurringPrices: jest.fn().mockResolvedValue([]),
    subscriptionSnapshot: jest.fn().mockResolvedValue({ active: 0, trialing: 0, canceling: 0, pastDue: 0, renewing7d: 0 }),
    subscriptionPeriod: jest.fn().mockResolvedValue(zeroPeriod),
    subscriptionSeries: jest.fn().mockResolvedValue([]),
    acquisitionTotals: jest.fn().mockResolvedValue({ started: 0, linked: 0, activated: 0 }),
    acquisitionSeries: jest.fn().mockResolvedValue([]),
    mixByRecipe: jest.fn().mockResolvedValue([]),
    mixByPackSize: jest.fn().mockResolvedValue([]),
    cyclesByStatus: jest.fn().mockResolvedValue({ byStatus: { to_prepare: 0, in_production: 0, ready: 0, blocked: 0 }, late: 0 }),
    awaitingPayment: jest.fn().mockResolvedValue(0),
    shipmentsByStatus: jest.fn().mockResolvedValue([]),
    stockRows: jest.fn().mockResolvedValue([]),
    ...overrides
  };
}

function service(repository = fakeRepository(), options = {}) {
  return new AdminReportsService({ repository, now: () => NOW, ...options });
}

describe('AdminReportsService', () => {
  test('rejects an unknown report and an admin without a market', async () => {
    await expect(service().report('customers', {}, BR)).rejects.toMatchObject({ statusCode: 400, details: { code: 'report_unknown' } });
    await expect(service().report('revenue', {}, BOTH)).rejects.toMatchObject({ statusCode: 400, details: { code: 'report_market_required' } });
  });

  test('revenue reports gross revenue, ticket and the previous window in minor units', async () => {
    const invoiceTotals = jest.fn()
      .mockResolvedValueOnce({ revenue: 30000, invoices: 2, firstPurchaseRevenue: 15000, firstPurchaseInvoices: 1, excludedInvoices: 0 })
      .mockResolvedValueOnce({ revenue: 0, invoices: 0, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 });
    const repository = fakeRepository({ invoiceTotals });
    const report = await service(repository).report('revenue', {}, BR);

    expect(report).toMatchObject({ market: 'BR', currency: 'BRL', period: { from: '2026-09-28', to: '2026-10-27' } });
    expect(report.kpis.grossRevenue).toEqual({ value: 30000, previous: 0 });
    expect(report.kpis.averageTicket).toEqual({ value: 15000, previous: null });
    expect(report.kpis.renewalRevenue).toEqual({ value: 15000, previous: 0 });
    expect(report.series).toHaveLength(30);
    expect(invoiceTotals).toHaveBeenCalledWith(expect.objectContaining({ account: 'br', currency: 'brl' }));
  });

  test('a single-market operator gets their market without asking and in its currency', async () => {
    const report = await service().report('revenue', {}, US);
    expect(report).toMatchObject({ market: 'US', currency: 'USD' });
    expect(report.period.timezone).toBe('America/New_York');
  });

  test('warns when invoices in another currency are left out', async () => {
    const logger = { warn: jest.fn() };
    const repository = fakeRepository({
      invoiceTotals: jest.fn().mockResolvedValue({ revenue: 0, invoices: 0, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 1 })
    });
    const report = await service(repository, { logger }).report('revenue', {}, BR);
    expect(report.excludedInvoices).toBe(1);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('estimated MRR leaves trialing and unpriced subscriptions out', async () => {
    const repository = fakeRepository({
      recurringPrices: jest.fn().mockResolvedValue([
        { status: 'active', subtotal: '150' },
        { status: 'trialing', subtotal: '150' },
        { status: 'active', subtotal: null }
      ])
    });
    const { estimatedMrr } = await service(repository).report('revenue', {}, US);
    expect(estimatedMrr).toEqual({ value: 15000, previous: null, estimated: true, trialingSubscriptions: 1, unpricedSubscriptions: 1 });
  });

  test('churn uses the cohort active at the start; in-and-out subscriptions count only as canceled', async () => {
    const repository = fakeRepository({
      subscriptionPeriod: jest.fn()
        .mockResolvedValueOnce({ newCount: 1, approximateNew: 0, canceled: 5, approximateCanceled: 1, activeAtStart: 100, churned: 4 })
        .mockResolvedValueOnce({ newCount: 0, approximateNew: 0, canceled: 0, approximateCanceled: 0, activeAtStart: 0, churned: 0 })
    });
    const report = await service(repository).report('subscriptions', {}, BR);

    expect(report.kpis.activeAtStart.value).toBe(100);
    expect(report.kpis.canceled.value).toBe(5);
    expect(report.kpis.churn).toEqual({ value: 0.04, previous: null });
    expect(report.approximateCanceledCount).toBe(1);
    expect(report.current.active).toEqual({ value: 0, previous: null });
  });

  test('acquisition conversions between stages', async () => {
    const repository = fakeRepository({
      acquisitionTotals: jest.fn().mockResolvedValue({ started: 200, linked: 120, activated: 90 })
    });
    const report = await service(repository).report('acquisition', {}, BR);
    expect(report.stages.activated.value).toBe(90);
    expect(report.conversions.startedToLinked.value).toBe(0.6);
    expect(report.conversions.linkedToActivated.value).toBe(0.75);
  });

  test('mix ignores the period and names recipes in the market language', async () => {
    const repository = fakeRepository({
      mixByRecipe: jest.fn().mockResolvedValue([{ flavor: 'turkey', flavorLabel: 'Turkey', packs: '12', subscriptions: '4' }]),
      mixByPackSize: jest.fn().mockResolvedValue([{ grams: 454, packs: 12, subscriptions: 4 }])
    });
    const recipeNamesRepository = { listRecipeNames: jest.fn().mockResolvedValue({ US: { turkey: { label: 'Turkey & Rice' } } }) };
    const report = await service(repository, { recipeNamesRepository }).report('mix', { from: '2026-01-01' }, US);

    expect(report.period).toBeNull();
    expect(report.recipes).toEqual([{ key: 'turkey', name: 'Turkey & Rice', nameMissing: false, packs: 12, subscriptions: 4 }]);
    expect(report.packSizes[0]).toMatchObject({ label: '16.0 oz (454 g)', share: 1 });
  });

  test('mix shows a recipe without a catalog name by its key and flags it', async () => {
    const repository = fakeRepository({
      mixByRecipe: jest.fn().mockResolvedValue([{ flavor: 'bovino', flavorLabel: 'Bovino', packs: 5, subscriptions: 1 }])
    });
    const recipeNamesRepository = { listRecipeNames: jest.fn().mockResolvedValue({ US: {} }) };
    const report = await service(repository, { recipeNamesRepository }).report('mix', {}, US);
    expect(report.recipes[0]).toMatchObject({ key: 'bovino', name: 'bovino', nameMissing: true });
  });

  test('pack sizes stay one row per gram weight even when the ounces round the same', async () => {
    const repository = fakeRepository({
      mixByPackSize: jest.fn().mockResolvedValue([{ grams: 499, packs: 100, subscriptions: 1 }, { grams: 500, packs: 40, subscriptions: 4 }])
    });
    const report = await service(repository).report('mix', {}, US);
    expect(report.packSizes.map((row) => row.label)).toEqual(['17.6 oz (499 g)', '17.6 oz (500 g)']);

    const br = await service(fakeRepository({ mixByPackSize: jest.fn().mockResolvedValue([{ grams: 300, packs: 1, subscriptions: 1 }]) })).report('mix', {}, BR);
    expect(br.packSizes[0].label).toBe('300 g');
  });

  test('only an admin sees how many checkouts of the period have no market', async () => {
    const repository = fakeRepository({ unassignedCheckouts: jest.fn().mockResolvedValue(4) });
    const admin = { roles: ['admin'], markets: ['BR', 'US'] };
    const operator = { roles: ['operator'], markets: ['BR'] };

    const forAdmin = await service(repository).report('acquisition', { market: 'BR' }, { markets: ['BR'] }, admin);
    expect(forAdmin.unassignedCheckouts).toBe(4);

    const forOperator = await service(repository).report('acquisition', {}, BR, operator);
    expect(forOperator).not.toHaveProperty('unassignedCheckouts');
    expect(repository.unassignedCheckouts).toHaveBeenCalledTimes(1);
  });

  test('operations: late cycles against the local today, awaiting payment, no UPS block in Brazil', async () => {
    const repository = fakeRepository({
      cyclesByStatus: jest.fn().mockResolvedValue({ byStatus: { to_prepare: 1, in_production: 2, ready: 3, blocked: 0 }, late: 1 }),
      awaitingPayment: jest.fn().mockResolvedValue(7)
    });
    const report = await service(repository).report('operations', {}, BR);

    expect(repository.cyclesByStatus).toHaveBeenCalledWith(expect.objectContaining({ today: '2026-10-28', from: '2026-09-28', to: '2026-10-27' }));
    expect(report.cycles.in_production.value).toBe(2);
    expect(report.late.value).toBe(1);
    expect(report.awaitingPayment).toEqual({ value: 7, previous: null });
    expect(report.shipments).toBeNull();
  });

  test('US operations count UPS shipments without voided ones in the total', async () => {
    const repository = fakeRepository({
      shipmentsByStatus: jest.fn().mockResolvedValue([{ status: 'shipped', shipments: 8 }, { status: 'voided', shipments: 2 }])
    });
    const report = await service(repository).report('operations', {}, US);
    expect(report.shipments.total.value).toBe(8);
    expect(report.shipments.byStatus.voided.value).toBe(2);
  });

  test('stock rows net separation reversals and total the columns', async () => {
    const repository = fakeRepository({
      stockRows: jest.fn().mockResolvedValue([{ flavorKey: 'frango', grams: 300, onHand: 20, minLevel: 5, produced: 50, separated: 35, adjusted: -3 }])
    });
    const report = await service(repository).report('stock', {}, BR);
    expect(report.rows[0]).toMatchObject({ key: 'frango', label: '300 g', separated: 35, adjusted: -3 });
    expect(report.totals.separated.value).toBe(35);
    expect(report.totals.onHand).toEqual({ value: 20, previous: null });
  });

  test('summary returns one block per market in scope, each in its own currency, without a total', async () => {
    const both = await service().report('summary', {}, BOTH);
    expect(both.markets.map((block) => [block.market, block.currency])).toEqual([['BR', 'BRL'], ['US', 'USD']]);
    expect(both).not.toHaveProperty('total');

    const brOnly = await service().report('summary', {}, BR);
    expect(brOnly.markets.map((block) => block.market)).toEqual(['BR']);
  });
});
