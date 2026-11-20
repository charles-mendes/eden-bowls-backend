const { AdminReportsService } = require('../src/services/admin-reports.service');
const { formatCell, toReportCsv } = require('../src/core/report-csv');

const NOW = new Date('2026-10-28T18:00:00Z');

function revenueService(revenue = 1234567) {
  const repository = {
    invoiceTotals: jest.fn().mockResolvedValue({ revenue, invoices: 2, firstPurchaseRevenue: 0, firstPurchaseInvoices: 0, excludedInvoices: 0 }),
    invoiceSeries: jest.fn().mockResolvedValue([{ hour: '2026-10-05 15', revenue, invoices: 2 }]),
    recurringPrices: jest.fn().mockResolvedValue([])
  };
  return new AdminReportsService({ repository, now: () => NOW });
}

describe('report CSV', () => {
  test('excel format: BOM, semicolons and a decimal comma, with the currency column', async () => {
    const { csv, filename } = await revenueService().exportCsv({ report: 'revenue' }, { markets: ['US'] });

    expect(csv.startsWith('﻿')).toBe(true);
    expect(filename).toBe('eden-revenue-US-2026-09-28-2026-10-27.csv');
    const line = csv.split('\r\n').find((row) => row.endsWith('"grossRevenue"'));
    expect(line).toBe('"Receita";"Indicadores";"";"Faturamento bruto";"2026-09-28";"2026-10-27";"";"12345,67";"dinheiro";"USD";"12345,67";"2026-08-29";"2026-09-27";"0";"%";"Inclui impostos e frete cobrados; não desconta reembolsos.";"grossRevenue"');
  });

  test('csv format: no BOM, commas and a decimal point', async () => {
    const { csv } = await revenueService().exportCsv({ report: 'revenue', formato: 'csv' }, { markets: ['US'] });
    expect(csv.startsWith('﻿')).toBe(false);
    expect(csv).toContain('"Receita","Indicadores","","Faturamento bruto","2026-09-28","2026-10-27","","12345.67","dinheiro","USD","12345.67"');
  });

  test('the series in the CSV matches the JSON buckets', async () => {
    const service = revenueService(30000);
    const json = await service.report('revenue', {}, { markets: ['BR'] });
    const { csv } = await service.exportCsv({ report: 'revenue', formato: 'csv' }, { markets: ['BR'] });
    const seriesLines = csv.split('\r\n').filter((row) => row.endsWith('"series.revenue"'));

    expect(seriesLines).toHaveLength(json.series.length);
    expect(seriesLines.find((row) => row.includes('"2026-10-05"'))).toContain('"300.00"');
  });

  test('escapes text that would run as a formula and leaves negative numbers alone', () => {
    expect(formatCell('=HYPERLINK("x")', { decimal: ',' })).toBe('\'=HYPERLINK("x")');
    expect(formatCell('@SUM(A1)', { decimal: ',' })).toBe('\'@SUM(A1)');
    expect(formatCell(-3, { decimal: ',' })).toBe('-3');
    expect(formatCell(0.04, { decimal: ',' })).toBe('0,04');

    const csv = toReportCsv('stock', {
      period: { from: '2026-10-01', to: '2026-10-27' },
      currency: 'BRL',
      rows: [{ key: 'x', grams: 300, name: '=HYPERLINK("x")', label: '300 g', produced: 1, separated: 0, adjusted: -3, onHand: 5, minLevel: null }],
      totals: {}
    }, 'csv');
    expect(csv).toContain('"\'=HYPERLINK(""x"") · 300 g"');
    expect(csv).toContain('"Ajustado","2026-10-01","2026-10-27","","-3"');
  });

  test('marks a recipe without a catalog name in the market', () => {
    const csv = toReportCsv('mix', {
      market: 'US',
      currency: 'USD',
      recipes: [{ key: 'bovino', name: 'bovino', nameMissing: true, packs: 5, subscriptions: 1 }],
      packSizes: []
    }, 'csv');
    expect(csv).toContain('"Pacotes por entrega","Receitas","bovino (sem nome no catálogo EUA)","Pacotes por entrega"');
  });

  test('rejects an unknown report or format', async () => {
    await expect(revenueService().exportCsv({ report: 'customers' }, { markets: ['BR'] })).rejects.toMatchObject({ details: { code: 'report_unknown' } });
    await expect(revenueService().exportCsv({ report: 'revenue', formato: 'xlsx' }, { markets: ['BR'] })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('has no personal data columns', async () => {
    const { csv } = await revenueService().exportCsv({ report: 'revenue' }, { markets: ['BR'] });
    expect(csv).not.toMatch(/@|email|cus_|sub_/i);
  });
});

describe('report CSV mirrors every Relatórios tab', () => {
  const period = { from: '2026-10-20', to: '2026-10-21', timezone: 'America/New_York', granularity: 'day', partialToday: false, previous: { from: '2026-10-18', to: '2026-10-19' } };
  const base = { market: 'US', currency: 'USD', period, generatedAt: '2026-10-22T12:00:00.000Z' };
  const lines = (name, report) => toReportCsv(name, report, 'csv').split('\r\n');
  const line = (rows, key) => rows.find((row) => row.endsWith(`"${key}"`));

  test('every tab starts with the market, the window and the comparison window', () => {
    const rows = lines('operations', { ...base, cycles: {}, late: { value: 0, previous: 0 }, awaitingPayment: { value: 0, previous: null }, shipments: null });
    expect(line(rows, 'market')).toContain('"Operação","Relatório","","Mercado","","","","EUA (US)"');
    expect(line(rows, 'period')).toContain('"Período","2026-10-20","2026-10-21","não","20/10/2026 a 21/10/2026"');
    expect(line(rows, 'period.previous')).toContain('"18/10/2026 a 19/10/2026","","","","2026-10-18","2026-10-19"');
  });

  test('summary: one block per market with labels, change and point-in-time cards', () => {
    const kpis = {
      grossRevenue: { value: 20000, previous: 10000 }, paidInvoices: { value: 2, previous: 1 }, averageTicket: { value: 10000, previous: 10000 },
      activeSubscriptions: { value: 7, previous: null }, new: { value: 3, previous: 4 }, canceled: { value: 1, previous: 0 },
      churn: { value: 0.1, previous: 0.05 }, checkoutsStarted: { value: 10, previous: 5 }, checkoutToActivation: { value: 0.3, previous: 0.2 }
    };
    const rows = lines('summary', { period, generatedAt: base.generatedAt, markets: [{ market: 'US', currency: 'USD', period, kpis }] });
    expect(line(rows, 'grossRevenue')).toContain('"Resumo","EUA · US$","","Faturamento bruto","2026-10-20","2026-10-21","","200.00","dinheiro","USD","100.00","2026-10-18","2026-10-19","100","%"');
    expect(line(rows, 'churn')).toContain('"Churn","2026-10-20","2026-10-21","","10","%","","5","2026-10-18","2026-10-19","5","p.p."');
    expect(line(rows, 'activeSubscriptions')).toContain('"Assinaturas ativas","","","","7","quantidade","","","","","","","agora');
    expect(line(rows, 'canceled')).toContain('"1","quantidade","","0","2026-10-18","2026-10-19","",""');
  });

  test('subscriptions: snapshot, period cards, warnings and the series with totals', () => {
    const kpi = (value, previous = null) => ({ value, previous });
    const rows = lines('subscriptions', {
      ...base,
      current: { active: kpi(5), trialing: kpi(1), canceling: kpi(0), pastDue: kpi(2), renewing7d: kpi(3) },
      kpis: { new: kpi(4, 2), canceled: kpi(1, 1), activeAtStart: kpi(10, 9), churn: kpi(0.1, 0.1111) },
      approximateNewCount: 2,
      approximateCanceledCount: 0,
      series: [
        { key: '2026-10-20', from: '2026-10-20', to: '2026-10-20', partial: false, newCount: 3, canceled: 1 },
        { key: '2026-10-21', from: '2026-10-21', to: '2026-10-21', partial: true, newCount: 1, canceled: 0 }
      ]
    });
    expect(line(rows, 'current.pastDue')).toContain('"Assinaturas","Agora","","Pagamento atrasado"');
    expect(line(rows, 'new')).toContain('"No período","","Novas","2026-10-20","2026-10-21","","4","quantidade","","2","2026-10-18","2026-10-19","100","%"');
    expect(line(rows, 'approximateNewCount')).toContain('"Avisos","","Novas assinaturas com data aproximada","","","","2"');
    expect(rows.filter((row) => row.endsWith('"series.newCount"'))[1]).toContain('"21/10/2026","Novas","2026-10-21","2026-10-21","sim","1"');
    expect(line(rows, 'series.newCount.total')).toContain('"Total do período","Novas","2026-10-20","2026-10-21","","4"');
  });

  test('acquisition: funnel stages, conversions and unassigned checkouts', () => {
    const rows = lines('acquisition', {
      ...base,
      unassignedCheckouts: 3,
      stages: { started: { value: 10, previous: 8 }, linked: { value: 5, previous: 4 }, activated: { value: 2, previous: 2 } },
      conversions: { startedToLinked: { value: 0.5, previous: 0.5 }, linkedToActivated: { value: 0.4, previous: 0.5 }, startedToActivated: { value: 0.2, previous: 0.25 } },
      series: []
    });
    expect(line(rows, 'stages.linked')).toContain('"Funil de aquisição","","Vinculados ao Stripe","2026-10-20","2026-10-21","","5"');
    expect(line(rows, 'conversions.startedToActivated')).toContain('"Conversão total","2026-10-20","2026-10-21","","20","%","","25","2026-10-18","2026-10-19","-5","p.p."');
    expect(line(rows, 'unassignedCheckouts')).toContain('"Checkouts sem mercado fora do funil","","","","3"');
  });

  test('mix: recipes and pack sizes with share, marked as a snapshot', () => {
    const rows = lines('mix', {
      market: 'US', currency: 'USD', period: null, generatedAt: base.generatedAt,
      recipes: [{ key: 'beef', name: 'Beef', nameMissing: false, packs: 3, subscriptions: 2 }, { key: 'fish', name: 'Fish', nameMissing: false, packs: 1, subscriptions: 1 }],
      packSizes: [{ grams: 300, label: '300 g', packs: 4, subscriptions: 3, share: 1 }]
    });
    expect(line(rows, 'period')).toContain('"Período","","","","agora"');
    expect(line(rows, 'recipes.beef.share')).toContain('"Receitas","Beef","Participação nos pacotes","","","","75","%"');
    expect(line(rows, 'packSizes.300.share')).toContain('"Tamanhos de pacote","300 g","Participação","","","","100","%"');
    expect(line(rows, 'recipes.packs.total')).toContain('"Total","","Pacotes por entrega","","","","4"');
  });

  test('operations: cycles by status, late, awaiting payment and UPS shipments by status', () => {
    const rows = lines('operations', {
      ...base,
      cycles: { to_prepare: { value: 2, previous: 1 }, in_production: { value: 0, previous: 0 }, ready: { value: 1, previous: 2 }, blocked: { value: 0, previous: 0 } },
      late: { value: 1, previous: 0 },
      awaitingPayment: { value: 4, previous: null },
      shipments: { total: { value: 3, previous: 1 }, byStatus: { delivered: { value: 2, previous: 1 }, voided: { value: 1, previous: 0 } } }
    });
    expect(line(rows, 'cycles.to_prepare')).toContain('"Ciclos pagos por status","","A preparar","2026-10-20","2026-10-21","","2","quantidade","","1"');
    expect(line(rows, 'awaitingPayment')).toContain('"Aguardando pagamento","","","","4","quantidade","","","","","","","agora');
    expect(line(rows, 'shipments.byStatus.delivered')).toContain('"Envios UPS por status","Entregues","Envios","2026-10-20","2026-10-21","","2"');
    expect(line(rows, 'shipments.total')).toContain('"Envios (sem cancelados)"');
  });

  test('stock: each recipe and pack with movements, balance, minimum and totals', () => {
    const rows = lines('stock', {
      ...base,
      rows: [{ key: 'beef', name: 'Beef', nameMissing: false, grams: 300, label: '300 g', produced: 10, separated: 4, adjusted: 0, onHand: 2, minLevel: 5 }],
      totals: { produced: { value: 10, previous: 6 }, separated: { value: 4, previous: 4 }, adjusted: { value: 0, previous: 0 }, onHand: { value: 2, previous: null } }
    });
    expect(line(rows, 'rows.beef.300.produced')).toContain('"Estoque por receita e pack","Beef · 300 g","Produzido","2026-10-20","2026-10-21","","10"');
    expect(line(rows, 'rows.beef.300.onHand')).toContain('"agora · abaixo do mínimo"');
    expect(line(rows, 'totals.produced')).toContain('"Total","","Produzido","2026-10-20","2026-10-21","","10","quantidade","","6","2026-10-18","2026-10-19","66.7","%"');
  });
});
