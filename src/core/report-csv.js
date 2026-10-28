const { HttpError } = require('./http-error');

const FORMATS = {
  // Excel set to Portuguese expects ';', a decimal comma and a BOM to read UTF-8 accents.
  excel: { separator: ';', decimal: ',', bom: '﻿' },
  csv: { separator: ',', decimal: '.', bom: '' }
};
const HEADER = ['secao', 'item', 'indicador', 'de', 'ate', 'parcial', 'valor', 'anterior', 'moeda'];
const MONEY_KEYS = new Set(['grossRevenue', 'averageTicket', 'firstPurchaseRevenue', 'renewalRevenue', 'estimatedMrr', 'revenue']);
const FORMULA_START = /^[=+\-@\t\r]/;

function resolveCsvFormat(value) {
  const format = value == null || value === '' ? 'excel' : String(value);
  if (!FORMATS[format]) {
    throw new HttpError(400, 'Format must be excel or csv.', { code: 'report_format_invalid' });
  }
  return format;
}

const money = (minor) => (minor == null ? null : { money: Number(minor) });

function formatNumber(value, decimal) {
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Math.round(value * 10000) / 10000).replace('.', decimal);
}

function formatCell(cell, options) {
  if (cell == null) {
    return '';
  }
  if (typeof cell === 'object' && 'money' in cell) {
    return (cell.money / 100).toFixed(2).replace('.', options.decimal);
  }
  if (typeof cell === 'number') {
    return formatNumber(cell, options.decimal);
  }
  if (typeof cell === 'boolean') {
    return cell ? 'sim' : 'nao';
  }
  const text = String(cell);
  // Text that a spreadsheet would run as a formula gets a leading quote; numbers above are never touched.
  return FORMULA_START.test(text) ? `'${text}` : text;
}

const MARKET_NAMES = { BR: 'Brasil', US: 'EUA' };

function itemName(row, market) {
  return row.nameMissing ? `${row.name} (sem nome no catálogo ${MARKET_NAMES[market] || market})` : row.name;
}

function kpiRows(section, values, period, currency) {
  return Object.entries(values || {}).map(([key, entry]) => {
    const isMoney = MONEY_KEYS.has(key);
    const value = entry && typeof entry === 'object' ? entry.value : entry;
    const previous = entry && typeof entry === 'object' ? entry.previous : null;
    return [section, '', key, period && period.from, period && period.to, '',
      isMoney ? money(value) : value, isMoney ? money(previous) : previous, isMoney ? currency : ''];
  });
}

function seriesRows(series, currency) {
  const rows = [];
  for (const bucket of series || []) {
    for (const [key, value] of Object.entries(bucket)) {
      if (['key', 'from', 'to', 'partial'].includes(key)) continue;
      const isMoney = MONEY_KEYS.has(key);
      rows.push(['serie', '', key, bucket.from, bucket.to, bucket.partial, isMoney ? money(value) : value, null, isMoney ? currency : '']);
    }
  }
  return rows;
}

function reportRows(name, report) {
  const { period, currency } = report;
  switch (name) {
    case 'revenue':
      return [
        ...kpiRows('kpi', report.kpis, period, currency),
        ...kpiRows('mrr', { estimatedMrr: report.estimatedMrr, trialingSubscriptions: report.estimatedMrr.trialingSubscriptions, unpricedSubscriptions: report.estimatedMrr.unpricedSubscriptions }, null, currency),
        ...kpiRows('controle', { excludedInvoices: report.excludedInvoices }, period, currency),
        ...seriesRows(report.series, currency)
      ];
    case 'subscriptions':
      return [
        ...kpiRows('agora', report.current, null, currency),
        ...kpiRows('kpi', report.kpis, period, currency),
        ...kpiRows('controle', { approximateNewCount: report.approximateNewCount, approximateCanceledCount: report.approximateCanceledCount }, period, currency),
        ...seriesRows(report.series, currency)
      ];
    case 'acquisition':
      return [
        ...kpiRows('etapa', report.stages, period, currency),
        ...kpiRows('conversao', report.conversions, period, currency),
        ...(report.unassignedCheckouts == null ? [] : kpiRows('controle', { unassignedCheckouts: report.unassignedCheckouts }, period, currency)),
        ...seriesRows(report.series, currency)
      ];
    case 'mix':
      return [
        ...report.recipes.map((row) => ({ ...row, name: itemName(row, report.market) })).flatMap((row) => [
          ['receita', row.name, 'packs', '', '', '', row.packs, null, ''],
          ['receita', row.name, 'subscriptions', '', '', '', row.subscriptions, null, '']
        ]),
        ...report.packSizes.flatMap((row) => [
          ['pack', row.label, 'packs', '', '', '', row.packs, null, ''],
          ['pack', row.label, 'subscriptions', '', '', '', row.subscriptions, null, ''],
          ['pack', row.label, 'share', '', '', '', row.share, null, '']
        ])
      ];
    case 'operations':
      return [
        ...kpiRows('ciclos', report.cycles, period, currency),
        ...kpiRows('kpi', { late: report.late, awaitingPayment: report.awaitingPayment }, period, currency),
        ...(report.shipments ? [
          ...kpiRows('envios', { total: report.shipments.total }, period, currency),
          ...kpiRows('envios', report.shipments.byStatus, period, currency)
        ] : [])
      ];
    case 'stock':
      return [
        ...report.rows.flatMap((row) => ['produced', 'separated', 'adjusted', 'onHand', 'minLevel'].map((key) => (
          ['estoque', `${itemName(row, report.market)} ${row.label}`, key, period.from, period.to, '', row[key], null, '']
        ))),
        ...kpiRows('total', report.totals, period, currency)
      ];
    case 'summary':
      return report.markets.flatMap((block) => kpiRows('mercado', block.kpis, block.period, block.currency)
        .map((row) => [row[0], block.market, ...row.slice(2)]));
    default:
      throw new HttpError(400, 'Unknown report.', { code: 'report_unknown' });
  }
}

function toReportCsv(name, report, format = 'excel') {
  const options = FORMATS[resolveCsvFormat(format)];
  const lines = [HEADER, ...reportRows(name, report)].map((row) => row
    .map((cell) => `"${formatCell(cell, options).replace(/"/g, '""')}"`)
    .join(options.separator));
  return `${options.bom}${lines.join('\r\n')}\r\n`;
}

function reportFilename(name, market, from, to) {
  return `eden-${name}-${market}-${from}-${to}.csv`;
}

module.exports = {
  formatCell,
  reportFilename,
  resolveCsvFormat,
  toReportCsv
};
