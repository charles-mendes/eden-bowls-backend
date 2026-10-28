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
    const line = csv.split('\r\n').find((row) => row.includes('"grossRevenue"'));
    expect(line).toBe('"kpi";"";"grossRevenue";"2026-09-28";"2026-10-27";"";"12345,67";"12345,67";"USD"');
  });

  test('csv format: no BOM, commas and a decimal point', async () => {
    const { csv } = await revenueService().exportCsv({ report: 'revenue', formato: 'csv' }, { markets: ['US'] });
    expect(csv.startsWith('﻿')).toBe(false);
    expect(csv).toContain('"kpi","","grossRevenue","2026-09-28","2026-10-27","","12345.67","12345.67","USD"');
  });

  test('the series in the CSV matches the JSON buckets', async () => {
    const service = revenueService(30000);
    const json = await service.report('revenue', {}, { markets: ['BR'] });
    const { csv } = await service.exportCsv({ report: 'revenue', formato: 'csv' }, { markets: ['BR'] });
    const seriesLines = csv.split('\r\n').filter((row) => row.startsWith('"serie"') && row.includes('"revenue"'));

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
      rows: [{ name: '=HYPERLINK("x")', label: '300 g', produced: 1, separated: 0, adjusted: -3, onHand: 5, minLevel: null }],
      totals: {}
    }, 'csv');
    expect(csv).toContain('"\'=HYPERLINK(""x"") 300 g"');
    expect(csv).toContain('"adjusted","2026-10-01","2026-10-27","","-3"');
  });

  test('marks a recipe without a catalog name in the market', () => {
    const csv = toReportCsv('mix', {
      market: 'US',
      currency: 'USD',
      recipes: [{ key: 'bovino', name: 'bovino', nameMissing: true, packs: 5, subscriptions: 1 }],
      packSizes: []
    }, 'csv');
    expect(csv).toContain('"receita","bovino (sem nome no catálogo EUA)","packs"');
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
