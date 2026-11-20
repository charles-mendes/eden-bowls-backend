const { AdminReportsService } = require('../src/services/admin-reports.service');
const { AdminReportDetailsService } = require('../src/services/admin-report-details.service');

// 2026-10-28 15:00 in Sao Paulo; the default window is 2026-09-28..2026-10-27.
const NOW = new Date('2026-10-28T18:00:00Z');
const BR = { markets: ['BR'] };
const OPERATOR = { roles: ['operator'], permissions: ['reports.read', 'reports.export', 'billing.subscribers.read'] };
const NO_SUBSCRIBERS = { roles: ['custom'], permissions: ['reports.read'] };
const PAGE = { page: 1, perPage: 50, offset: 0 };

function aggregates(overrides = {}) {
  const zeroInvoices = { revenue: 0, invoices: 0, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 };
  return {
    invoiceTotals: jest.fn().mockResolvedValue(zeroInvoices),
    invoiceSeries: jest.fn().mockResolvedValue([]),
    recurringPrices: jest.fn().mockResolvedValue([]),
    subscriptionSnapshot: jest.fn().mockResolvedValue({ active: 0, trialing: 0, canceling: 0, pastDue: 0, renewing7d: 0 }),
    subscriptionPeriod: jest.fn().mockResolvedValue({ newCount: 0, approximateNew: 0, canceled: 0, approximateCanceled: 0, activeAtStart: 0, churned: 0 }),
    subscriptionSeries: jest.fn().mockResolvedValue([]),
    acquisitionTotals: jest.fn().mockResolvedValue({ started: 0, linked: 0, activated: 0 }),
    acquisitionSeries: jest.fn().mockResolvedValue([]),
    unassignedCheckouts: jest.fn().mockResolvedValue(0),
    mixByRecipe: jest.fn().mockResolvedValue([]),
    mixByPackSize: jest.fn().mockResolvedValue([]),
    cyclesByStatus: jest.fn().mockResolvedValue({ byStatus: { to_prepare: 0, in_production: 0, ready: 0, blocked: 0 }, late: 0 }),
    awaitingPayment: jest.fn().mockResolvedValue(0),
    shipmentsByStatus: jest.fn().mockResolvedValue([]),
    stockRows: jest.fn().mockResolvedValue([]),
    detailRecords: jest.fn().mockResolvedValue([]),
    detailTotals: jest.fn().mockResolvedValue({ totals: { count: 0, contribution: 0 }, groups: [] }),
    customerNames: jest.fn().mockResolvedValue({}),
    ...overrides
  };
}

function build(repository, logger = { error: jest.fn(), warn: jest.fn() }) {
  const reportsService = new AdminReportsService({ repository, now: () => NOW, logger });
  return { details: new AdminReportDetailsService({ reportsService, repository, logger }), logger };
}

const invoiceRow = (id, amount, extra = {}) => ({
  id: String(id), invoiceNumber: `EB-2026-00000${id}`, date: '2026-10-05T15:00:00Z', groupKey: 'subscription_create',
  amount: String(amount), currency: 'brl', userId: '7', subscriptionId: '42', contribution: String(amount), ...extra
});

describe('AdminReportDetailsService', () => {
  test('gross revenue: records, subtotals, excluded invoices and a check that adds up', async () => {
    const repository = aggregates({
      invoiceTotals: jest.fn().mockResolvedValue({ revenue: 150000, invoices: 2, firstPurchaseRevenue: 100000, firstPurchaseInvoices: 1, excludedInvoices: 1 }),
      detailRecords: jest.fn()
        .mockResolvedValueOnce([invoiceRow(1, 100000), invoiceRow(2, 50000, { groupKey: 'subscription_cycle' })])
        .mockResolvedValueOnce([{ id: '3', invoiceNumber: 'EB-2026-000003', date: '2026-10-06T10:00:00Z', groupKey: 'subscription_cycle', currency: 'usd', userId: '8', subscriptionId: null, contribution: '1' }]),
      detailTotals: jest.fn()
        .mockResolvedValueOnce({ totals: { count: 2, contribution: 150000 }, groups: [{ key: 'subscription_create', count: 1, contribution: 100000 }, { key: 'subscription_cycle', count: 1, contribution: 50000 }] })
        .mockResolvedValueOnce({ totals: { count: 1, contribution: 1 }, groups: [] }),
      customerNames: jest.fn().mockResolvedValue({ 7: 'Ana', 8: 'Bia' })
    });
    const { details, logger } = build(repository);
    const result = await details.details({ report: 'revenue', indicator: 'grossRevenue' }, BR, OPERATOR, PAGE);

    expect(result).toMatchObject({
      label: 'Faturamento bruto', kind: 'money', currency: 'BRL', value: 150000,
      window: { from: '2026-09-28', to: '2026-10-27', previous: false, bucket: null },
      reconciliation: { reportValue: 150000, recordsValue: 150000, matches: true },
      records: { page: 1, perPage: 50, total: 2 }
    });
    expect(result.groups).toEqual([
      { key: 'subscription_create', label: 'Primeira compra', count: 1, contribution: 100000 },
      { key: 'subscription_cycle', label: 'Renovação do ciclo', count: 1, contribution: 50000 }
    ]);
    expect(result.records.items[0]).toMatchObject({
      reference: 'EB-2026-000001', contribution: 100000, link: '/billing/subscriptions/42', customer: { name: 'Ana', link: '/users/7' }
    });
    expect(result.excluded).toEqual([expect.objectContaining({ reason: 'Moeda diferente da moeda do mercado', count: 1 })]);
    expect(result.excluded[0].items[0]).not.toHaveProperty('contribution');
    expect(result.criteria.join(' ')).toContain('impostos e frete');
    expect(result.formula.expression).toBe('Soma do valor pago de 2 faturas');
    expect(repository.detailRecords.mock.calls[0]).toEqual(['invoices', expect.objectContaining({ account: 'br', currency: 'brl', variant: 'paid', range: { start: '2026-09-28 03:00:00', end: '2026-10-28 03:00:00' } }), { contribution: 'amount' }, { limit: 50, offset: 0 }]);
    expect(logger.error).not.toHaveBeenCalled();
  });

  test('average ticket shows numerator and denominator and divides them', async () => {
    const repository = aggregates({
      invoiceTotals: jest.fn().mockResolvedValue({ revenue: 229500, invoices: 2, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 }),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 2, numerator: 229500, denominator: 2 }, groups: [] })
    });
    const result = await build(repository).details.details({ report: 'revenue', indicator: 'averageTicket' }, BR, OPERATOR, PAGE);
    expect(result.formula).toEqual({
      expression: 'Faturamento bruto ÷ Faturas pagas',
      terms: [{ label: 'Faturamento bruto', value: 229500, kind: 'money' }, { label: 'Faturas pagas', value: 2, kind: 'count' }],
      result: 114750
    });
    expect(result.reconciliation).toEqual({ reportValue: 114750, recordsValue: 114750, matches: true });
  });

  test('churn: the base of active subscriptions is the denominator, the ones that ended are the numerator', async () => {
    const repository = aggregates({
      subscriptionPeriod: jest.fn().mockResolvedValue({ newCount: 1, approximateNew: 0, canceled: 2, approximateCanceled: 0, activeAtStart: 10, churned: 1 }),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 10, numerator: 1, denominator: 10 }, groups: [] })
    });
    const result = await build(repository).details.details({ report: 'subscriptions', indicator: 'churn' }, BR, OPERATOR, PAGE);
    expect(result.value).toBe(0.1);
    expect(result.reconciliation.matches).toBe(true);
    expect(repository.detailTotals).toHaveBeenCalledWith('subscriptions', expect.objectContaining({ variant: 'activeAtStart' }), { numerator: 'churned', denominator: 'one' });
  });

  test('a gap between report and records is returned and logged, not adjusted', async () => {
    const repository = aggregates({
      invoiceTotals: jest.fn().mockResolvedValue({ revenue: 307741, invoices: 3, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 }),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 2, contribution: 300000 }, groups: [] })
    });
    const { details, logger } = build(repository);
    const result = await details.details({ report: 'revenue', indicator: 'grossRevenue' }, BR, OPERATOR, PAGE);

    expect(result.reconciliation).toEqual({ reportValue: 307741, recordsValue: 300000, matches: false });
    expect(result.value).toBe(307741);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ report: 'revenue', indicator: 'grossRevenue', market: 'BR', reportValue: 307741, recordsValue: 300000 }), expect.any(String));
  });

  test('a bar uses the bounds of its bucket, cut at now when it holds today', async () => {
    const repository = aggregates({
      invoiceSeries: jest.fn().mockResolvedValue([{ hour: '2026-10-28 14', revenue: 5000, invoices: 1 }]),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 1, contribution: 5000 }, groups: [] })
    });
    const result = await build(repository).details.details(
      { report: 'revenue', indicator: 'series.revenue', from: '2026-10-27', to: '2026-10-28', bucket: '2026-10-28' }, BR, OPERATOR, PAGE
    );
    expect(result.window.bucket).toEqual({ key: '2026-10-28', from: '2026-10-28', to: '2026-10-28', partial: true });
    expect(result.reconciliation).toMatchObject({ reportValue: 5000, matches: true });
    // Local midnight in Sao Paulo up to now (18:00 UTC).
    expect(repository.detailTotals.mock.calls[0][1].range).toEqual({ start: '2026-10-28 03:00:00', end: '2026-10-28 18:00:00' });
  });

  test('a bucket that is not in the series, or on a figure without series, is report_bucket_invalid', async () => {
    const { details } = build(aggregates());
    await expect(details.details({ report: 'revenue', indicator: 'series.revenue', bucket: '2027-01-01' }, BR, OPERATOR, PAGE))
      .rejects.toMatchObject({ statusCode: 400, details: { code: 'report_bucket_invalid' } });
    await expect(details.details({ report: 'revenue', indicator: 'grossRevenue', bucket: '2026-10-05' }, BR, OPERATOR, PAGE))
      .rejects.toMatchObject({ details: { code: 'report_bucket_invalid' } });
  });

  test('the previous period details the previous value in the previous window', async () => {
    const repository = aggregates({
      invoiceTotals: jest.fn()
        .mockResolvedValueOnce({ revenue: 0, invoices: 3, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 })
        .mockResolvedValueOnce({ revenue: 0, invoices: 3, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 }),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 3, contribution: 3 }, groups: [] })
    });
    const result = await build(repository).details.details({ report: 'revenue', indicator: 'paidInvoices', period: 'previous' }, BR, OPERATOR, PAGE);
    expect(result.window).toMatchObject({ from: '2026-08-29', to: '2026-09-27', previous: true });
    expect(result.value).toBe(3);
    expect(repository.detailTotals.mock.calls[0][1].range).toEqual({ start: '2026-08-29 03:00:00', end: '2026-09-28 03:00:00' });
  });

  test('a point-in-time figure has no previous period', async () => {
    await expect(build(aggregates()).details.details({ report: 'subscriptions', indicator: 'current.active', period: 'previous' }, BR, OPERATOR, PAGE))
      .rejects.toMatchObject({ statusCode: 400, details: { code: 'report_detail_no_previous' } });
  });

  test('summary cards open the figure of the market report', async () => {
    const repository = aggregates({
      subscriptionSnapshot: jest.fn().mockResolvedValue({ active: 2, trialing: 1, canceling: 0, pastDue: 0, renewing7d: 0 }),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 3, contribution: 3 }, groups: [{ key: 'active', count: 2, contribution: 2 }, { key: 'trialing', count: 1, contribution: 1 }] })
    });
    const result = await build(repository).details.details({ report: 'summary', indicator: 'activeSubscriptions', market: 'BR' }, BR, OPERATOR, PAGE);
    expect(result).toMatchObject({ report: 'summary', indicator: 'activeSubscriptions', source: { report: 'subscriptions', indicator: 'activeSubscriptions' }, value: 3 });
    expect(result.groups.map((group) => group.label)).toEqual(['Ativa', 'Em teste']);
    expect(repository.detailTotals).toHaveBeenCalledWith('subscriptions', expect.objectContaining({ variant: 'activeOrTrialing' }), { contribution: 'one' });
  });

  test('without the subscribers permission no customer name is asked or returned', async () => {
    const repository = aggregates({
      invoiceTotals: jest.fn().mockResolvedValue({ revenue: 100000, invoices: 1, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 }),
      detailRecords: jest.fn().mockResolvedValueOnce([invoiceRow(1, 100000)]).mockResolvedValue([]),
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 1, contribution: 100000 }, groups: [] })
    });
    const result = await build(repository).details.details({ report: 'revenue', indicator: 'grossRevenue' }, BR, NO_SUBSCRIBERS, PAGE);
    expect(result.records.items[0]).not.toHaveProperty('customer');
    expect(result.records.items[0]).toMatchObject({ reference: 'EB-2026-000001', link: '/billing/subscriptions/42' });
    expect(repository.customerNames).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/@|cus_|sub_|in_[A-Za-z0-9]|pi_/);
  });

  test('estimated MRR lists priced subscriptions and leaves trialing and unpriced ones apart', async () => {
    const repository = aggregates({
      recurringPrices: jest.fn().mockResolvedValue([
        { id: '1', userId: '7', status: 'active', subtotal: '150', date: '2026-08-01T12:00:00Z' },
        { id: '2', userId: '8', status: 'past_due', subtotal: '99.9', date: '2026-08-02T12:00:00Z' },
        { id: '3', userId: '9', status: 'trialing', subtotal: '99', date: '2026-10-20T12:00:00Z' },
        { id: '4', userId: '10', status: 'active', subtotal: null, date: '2026-09-01T12:00:00Z' }
      ])
    });
    const result = await build(repository).details.details({ report: 'revenue', indicator: 'estimatedMrr' }, BR, OPERATOR, PAGE);
    expect(result.value).toBe(24990);
    expect(result.records.items.map((record) => [record.reference, record.contribution])).toEqual([['Assinatura #1', 15000], ['Assinatura #2', 9990]]);
    expect(result.reconciliation).toEqual({ reportValue: 24990, recordsValue: 24990, matches: true });
    expect(result.excluded.map((rule) => [rule.reason, rule.count])).toEqual([['Em teste: ainda não cobra', 1], ['Sem preço mensal guardado no plano', 1]]);
    expect(result.pointInTime).toBe(true);
  });

  test('stock minimum is configuration, checked against itself', async () => {
    const repository = aggregates({
      stockRows: jest.fn().mockResolvedValue([{ flavorKey: 'frango', grams: 300, onHand: 20, minLevel: 5, produced: 0, separated: 0, adjusted: 0 }])
    });
    const result = await build(repository).details.details({ report: 'stock', indicator: 'rows.frango.300.minLevel' }, BR, OPERATOR, PAGE);
    expect(result).toMatchObject({ value: 5, reconciliation: { matches: true }, records: { total: 0 }, formula: { expression: 'Valor configurado no item de estoque' } });
    expect(repository.detailTotals).not.toHaveBeenCalled();
  });

  test('unassigned checkouts open only for an admin', async () => {
    const { details } = build(aggregates());
    await expect(details.details({ report: 'acquisition', indicator: 'unassignedCheckouts' }, BR, OPERATOR, PAGE))
      .rejects.toMatchObject({ details: { code: 'report_indicator_unknown' } });
    const result = await details.details({ report: 'acquisition', indicator: 'unassignedCheckouts', market: 'BR' }, BR, { roles: ['admin'], permissions: [] }, PAGE);
    expect(result.value).toBe(0);
  });

  test('a recipe that is not in the market is an unknown indicator', async () => {
    await expect(build(aggregates()).details.details({ report: 'mix', indicator: 'recipes.peixe.packs' }, BR, OPERATOR, PAGE))
      .rejects.toMatchObject({ details: { code: 'report_indicator_unknown' } });
  });

  test('CSV: every record, the total and the check, named after the figure', async () => {
    const repository = aggregates({
      invoiceTotals: jest.fn().mockResolvedValue({ revenue: 150000, invoices: 2, firstPurchaseRevenue: 100000, firstPurchaseInvoices: 1, excludedInvoices: 0 }),
      detailRecords: jest.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([invoiceRow(1, 100000), invoiceRow(2, 50000, { groupKey: 'subscription_cycle' })]),
      detailTotals: jest.fn()
        .mockResolvedValueOnce({ totals: { count: 2, contribution: 150000 }, groups: [{ key: 'subscription_create', count: 1, contribution: 100000 }, { key: 'subscription_cycle', count: 1, contribution: 50000 }] })
        .mockResolvedValueOnce({ totals: { count: 0, contribution: 0 }, groups: [] }),
      customerNames: jest.fn().mockResolvedValue({ 7: 'Ana' })
    });
    const { csv, filename } = await build(repository).details.exportCsv({ report: 'revenue', indicator: 'grossRevenue', formato: 'csv' }, BR, OPERATOR);
    const lines = csv.trim().split('\r\n');

    expect(filename).toBe('eden-revenue-grossRevenue-BR-2026-09-28-2026-10-27.csv');
    expect(lines[0]).toBe('"Bloco","Referência","Data","Grupo","Descrição","Cliente","Valor","Numerador","Denominador","Unidade","Moeda","Observação"');
    expect(lines.filter((line) => line.startsWith('"Registro"'))).toHaveLength(2);
    expect(lines.find((line) => line.includes('EB-2026-000001'))).toContain('"Ana","1000.00"');
    expect(lines.find((line) => line.startsWith('"Total"'))).toContain('"1500.00","","","dinheiro","BRL"');
    expect(lines.find((line) => line.startsWith('"Conferência"'))).toContain('"confere"');
    expect(repository.detailRecords).toHaveBeenLastCalledWith('invoices', expect.any(Object), { contribution: 'amount' }, { limit: 5000, offset: 0 });
  });

  test('CSV above 50,000 records is report_detail_too_large with the total', async () => {
    const repository = aggregates({
      detailTotals: jest.fn().mockResolvedValue({ totals: { count: 60000, contribution: 0 }, groups: [] })
    });
    await expect(build(repository).details.exportCsv({ report: 'revenue', indicator: 'grossRevenue' }, BR, OPERATOR))
      .rejects.toMatchObject({ statusCode: 413, details: { code: 'report_detail_too_large', total: 60000 } });
  });
});
