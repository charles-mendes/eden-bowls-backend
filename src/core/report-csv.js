const { HttpError } = require('./http-error');
const { SHIPMENT_LABELS, indicatorText } = require('./report-indicators');

const FORMATS = {
  // Excel set to Portuguese expects ';', a decimal comma and a BOM to read UTF-8 accents.
  excel: { separator: ';', decimal: ',', bom: '﻿' },
  csv: { separator: ',', decimal: '.', bom: '' }
};

// One flat table that reads like the Relatórios screen: same tabs, sections, labels and comparisons.
// "Chave" keeps the API field name so a row can be traced back to the JSON report.
const HEADER = [
  'Aba', 'Seção', 'Item', 'Indicador', 'De', 'Até', 'Parcial', 'Valor', 'Unidade', 'Moeda',
  'Período anterior', 'Anterior de', 'Anterior até', 'Variação', 'Unidade da variação', 'Observação', 'Chave'
];
const FORMULA_START = /^[=+\-@\t\r]/;

const TAB_LABELS = {
  summary: 'Resumo',
  revenue: 'Receita',
  subscriptions: 'Assinaturas',
  acquisition: 'Aquisição',
  mix: 'Pacotes por entrega',
  operations: 'Operação',
  stock: 'Estoque'
};
const MARKET_NAMES = { BR: 'Brasil', US: 'EUA' };
const GRANULARITY_LABELS = { day: 'Dia', week: 'Semana', month: 'Mês' };
const UNIT_LABELS = { money: 'dinheiro', count: 'quantidade', rate: '%' };
const CYCLE_STATUSES = ['to_prepare', 'in_production', 'ready', 'blocked'];
const PARTIAL_TODAY_NOTE = 'Hoje é comparado até o mesmo horário do período anterior.';

function resolveCsvFormat(value) {
  const format = value == null || value === '' ? 'excel' : String(value);
  if (!FORMATS[format]) {
    throw new HttpError(400, 'Format must be excel or csv.', { code: 'report_format_invalid' });
  }
  return format;
}

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
    return Number.isFinite(cell) ? formatNumber(cell, options.decimal) : '';
  }
  if (typeof cell === 'boolean') {
    return cell ? 'sim' : 'não';
  }
  const text = String(cell);
  // Text that a spreadsheet would run as a formula gets a leading quote; numbers above are never touched.
  return FORMULA_START.test(text) ? `'${text}` : text;
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round1 = (value) => Math.round(value * 10) / 10;

// Cell value in the unit the screen shows: money in major units, rates as a percentage.
function measure(value, kind) {
  if (!isNumber(value)) return null;
  if (kind === 'money') return { money: value };
  if (kind === 'rate') return round1(value * 100);
  return value;
}

// Same rule as the screen: % for counts and money, p.p. for rates, nothing when there is no base.
function variation(value, previous, kind) {
  if (!isNumber(value) || !isNumber(previous)) return [null, ''];
  if (kind === 'rate') return [round1((value - previous) * 100), 'p.p.'];
  if (previous === 0) return [null, ''];
  return [round1(((value - previous) / previous) * 100), '%'];
}

function formatDay(date) {
  if (!date) return '';
  const [year, month, day] = String(date).slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function itemName(row, market) {
  return row.nameMissing ? `${row.name} (sem nome no catálogo ${MARKET_NAMES[market] || market})` : row.name;
}

function marketLabel(market) {
  return MARKET_NAMES[market] ? `${MARKET_NAMES[market]} (${market})` : market;
}

// Builds the rows of one report; every helper returns full rows in HEADER order. Labels and hints of the
// figures come from the indicator catalog, the same texts the details show.
function createRows(tab, reportName) {
  const rows = [];

  const push = ({ section = '', item = '', label, from = '', to = '', partial = '', value = null, unit = '', currency = '',
    previous = null, previousFrom = '', previousTo = '', change = null, changeUnit = '', note = '', key = '' }) => {
    rows.push([tab, section, item, label, from, to, partial, value, unit, currency, previous, previousFrom, previousTo, change, changeUnit, note, key]);
  };

  const text = (key) => {
    const found = indicatorText(reportName, key);
    if (!found) throw new Error(`Report figure without a catalog entry: ${reportName}.${key}`);
    return found;
  };

  // A KPI card. `now` cards are a snapshot of this moment, so they carry no window and no comparison.
  const kpi = ({ section, item = '', entry, kind = 'count', now = false, period = null, currency = '', note = '', key }) => {
    const { label, hint } = text(key);
    const value = entry && typeof entry === 'object' ? entry.value : entry;
    const previous = now || !entry || typeof entry !== 'object' ? null : entry.previous;
    const [change, changeUnit] = now ? [null, ''] : variation(value, previous, kind);
    const notes = [now ? 'agora' : '', hint, note].filter(Boolean).join(' · ');
    push({
      section,
      item,
      label,
      from: !now && period ? period.from : '',
      to: !now && period ? period.to : '',
      value: measure(value, kind),
      unit: UNIT_LABELS[kind],
      currency: kind === 'money' ? currency : '',
      previous: now ? null : measure(previous, kind),
      previousFrom: !now && period && period.previous ? period.previous.from : '',
      previousTo: !now && period && period.previous ? period.previous.to : '',
      change,
      changeUnit,
      note: notes,
      key
    });
  };

  const info = (label, value, note = '', key = '', extra = {}) => push({ section: 'Relatório', label, value, note, key, ...extra });
  const warning = (value, key) => {
    const { label, hint } = text(key);
    push({ section: 'Avisos', label, value, unit: UNIT_LABELS.count, note: hint, key });
  };

  return { rows, push, kpi, info, warning, text };
}

function headerRows(builder, report, { snapshotNote } = {}) {
  const { info } = builder;
  const { period } = report;
  if (report.market) info('Mercado', marketLabel(report.market), '', 'market');
  if (report.currency) info('Moeda', report.currency, '', 'currency');
  if (period) {
    info('Período', `${formatDay(period.from)} a ${formatDay(period.to)}`, period.partialToday ? PARTIAL_TODAY_NOTE : '', 'period',
      { from: period.from, to: period.to, partial: Boolean(period.partialToday) });
    if (period.previous) {
      info('Período anterior (comparação)', `${formatDay(period.previous.from)} a ${formatDay(period.previous.to)}`, '', 'period.previous',
        { previousFrom: period.previous.from, previousTo: period.previous.to });
    }
    if (period.timezone) info('Fuso horário', period.timezone, '', 'period.timezone');
    if (period.granularity) info('Agrupamento', GRANULARITY_LABELS[period.granularity] || period.granularity, '', 'period.granularity');
  } else if (snapshotNote) {
    info('Período', 'agora', snapshotNote, 'period');
  }
  if (report.generatedAt) info('Gerado em', report.generatedAt, 'UTC', 'generatedAt');
}

function bucketLabel(bucket, granularity) {
  if (granularity === 'month') return String(bucket.from).slice(5, 7) + '/' + String(bucket.from).slice(0, 4);
  if (granularity === 'week') return `Semana de ${formatDay(bucket.from)}`;
  return formatDay(bucket.from);
}

// The bars of a chart, one row per bucket and measure, then the period total the chart's label reads.
function seriesRows(builder, { section, series, keys, period, currency }) {
  const granularity = period && period.granularity;
  const labelled = keys.map((item) => ({ ...item, label: builder.text(`series.${item.key}`).label }));
  for (const bucket of series || []) {
    for (const { key, label, kind = 'count' } of labelled) {
      builder.push({
        section,
        item: bucketLabel(bucket, granularity),
        label,
        from: bucket.from,
        to: bucket.to,
        partial: Boolean(bucket.partial),
        value: measure(Number(bucket[key] || 0), kind),
        unit: UNIT_LABELS[kind],
        currency: kind === 'money' ? currency : '',
        note: bucket.partial ? 'período parcial' : '',
        key: `series.${key}`
      });
    }
  }
  for (const { key, label, kind = 'count' } of labelled) {
    const total = (series || []).reduce((sum, bucket) => sum + Number(bucket[key] || 0), 0);
    builder.push({
      section,
      item: 'Total do período',
      label,
      from: period ? period.from : '',
      to: period ? period.to : '',
      value: measure(total, kind),
      unit: UNIT_LABELS[kind],
      currency: kind === 'money' ? currency : '',
      key: `series.${key}.total`
    });
  }
}

const SUMMARY_ROWS = [
  { key: 'grossRevenue', kind: 'money' },
  { key: 'paidInvoices' },
  { key: 'averageTicket', kind: 'money' },
  { key: 'activeSubscriptions', now: true },
  { key: 'new' },
  { key: 'canceled' },
  { key: 'churn', kind: 'rate' },
  { key: 'checkoutsStarted' },
  { key: 'checkoutToActivation', kind: 'rate' }
];

function summaryRows(builder, report) {
  builder.info('Mercados', (report.markets || []).map((block) => marketLabel(block.market)).join(', '), '', 'markets');
  if (report.generatedAt) builder.info('Gerado em', report.generatedAt, 'UTC', 'generatedAt');
  for (const block of report.markets || []) {
    const section = `${MARKET_NAMES[block.market] || block.market} · ${block.currency === 'BRL' ? 'R$' : 'US$'}`;
    const period = block.period;
    if (period) {
      builder.push({ section, label: 'Período', value: `${formatDay(period.from)} a ${formatDay(period.to)}`,
        from: period.from, to: period.to, partial: Boolean(period.partialToday),
        previousFrom: period.previous && period.previous.from, previousTo: period.previous && period.previous.to,
        note: [period.timezone, period.partialToday ? PARTIAL_TODAY_NOTE : ''].filter(Boolean).join(' · '), key: 'period' });
    }
    for (const row of SUMMARY_ROWS) {
      builder.kpi({ section, entry: block.kpis[row.key], kind: row.kind, now: row.now, period, currency: block.currency, key: row.key });
    }
  }
}

function revenueRows(builder, report) {
  const { kpis, estimatedMrr, period, currency } = report;
  const section = 'Indicadores';
  const card = (key, kind) => builder.kpi({ section, entry: kpis[key], kind, period, currency, key });
  card('grossRevenue', 'money');
  card('paidInvoices', 'count');
  card('averageTicket', 'money');
  builder.kpi({ section, entry: estimatedMrr, kind: 'money', now: true, currency, key: 'estimatedMrr' });
  builder.kpi({ section, entry: estimatedMrr.trialingSubscriptions, now: true, key: 'estimatedMrr.trialingSubscriptions' });
  builder.kpi({ section, entry: estimatedMrr.unpricedSubscriptions, now: true, key: 'estimatedMrr.unpricedSubscriptions' });
  card('firstPurchaseRevenue', 'money');
  card('renewalRevenue', 'money');
  builder.warning(report.excludedInvoices || 0, 'excludedInvoices');
  seriesRows(builder, {
    section: 'Faturamento bruto no período',
    series: report.series,
    period,
    currency,
    keys: [{ key: 'revenue', kind: 'money' }, { key: 'invoices' }]
  });
}

function subscriptionsRows(builder, report) {
  const { current, kpis, period } = report;
  for (const key of ['active', 'trialing', 'canceling', 'pastDue', 'renewing7d']) {
    builder.kpi({ section: 'Agora', entry: current[key], now: true, key: `current.${key}` });
  }
  const card = (key, kind) => builder.kpi({ section: 'No período', entry: kpis[key], kind, period, key });
  card('new');
  card('canceled');
  card('activeAtStart');
  card('churn', 'rate');
  builder.warning(report.approximateNewCount || 0, 'approximateNewCount');
  builder.warning(report.approximateCanceledCount || 0, 'approximateCanceledCount');
  seriesRows(builder, {
    section: 'Novas e cancelamentos',
    series: report.series,
    period,
    keys: [{ key: 'newCount' }, { key: 'canceled' }]
  });
}

function acquisitionRows(builder, report) {
  const { stages, conversions, period } = report;
  for (const key of ['started', 'linked', 'activated']) {
    builder.kpi({ section: 'Funil de aquisição', entry: stages[key], period, key: `stages.${key}` });
  }
  for (const key of ['startedToLinked', 'linkedToActivated', 'startedToActivated']) {
    builder.kpi({ section: 'Conversão', entry: conversions[key], kind: 'rate', period, key: `conversions.${key}` });
  }
  if (report.unassignedCheckouts != null) {
    builder.warning(report.unassignedCheckouts, 'unassignedCheckouts');
  }
  seriesRows(builder, { section: 'Checkouts iniciados', series: report.series, period, keys: [{ key: 'started' }] });
}

function mixRows(builder, report) {
  const recipes = report.recipes || [];
  const packSizes = report.packSizes || [];
  const totalPacks = recipes.reduce((sum, row) => sum + Number(row.packs || 0), 0);
  for (const row of recipes) {
    const item = itemName(row, report.market);
    const section = 'Receitas';
    builder.kpi({ section, item, entry: row.packs, now: true, key: `recipes.${row.key}.packs` });
    builder.kpi({ section, item, entry: row.subscriptions, now: true, key: `recipes.${row.key}.subscriptions` });
    builder.kpi({ section, item, entry: totalPacks ? row.packs / totalPacks : null, kind: 'rate', now: true, key: `recipes.${row.key}.share` });
  }
  if (!recipes.length) builder.push({ section: 'Receitas', label: 'Nenhuma assinatura ativa.', key: 'recipes' });
  for (const row of packSizes) {
    const section = 'Tamanhos de pacote';
    builder.kpi({ section, item: row.label, entry: row.subscriptions, now: true, key: `packSizes.${row.grams}.subscriptions` });
    builder.kpi({ section, item: row.label, entry: row.packs, now: true, key: `packSizes.${row.grams}.packs` });
    builder.kpi({ section, item: row.label, entry: row.share, kind: 'rate', now: true, key: `packSizes.${row.grams}.share` });
  }
  if (!packSizes.length) builder.push({ section: 'Tamanhos de pacote', label: 'Nenhuma assinatura ativa.', key: 'packSizes' });
  if (recipes.length) {
    builder.kpi({ section: 'Total', entry: totalPacks, now: true, key: 'recipes.packs.total' });
  }
}

function operationsRows(builder, report) {
  const { period } = report;
  for (const status of CYCLE_STATUSES) {
    builder.kpi({ section: 'Ciclos pagos por status', entry: report.cycles[status], period, key: `cycles.${status}` });
  }
  builder.kpi({ section: 'Indicadores', entry: report.late, period, key: 'late' });
  builder.kpi({ section: 'Indicadores', entry: report.awaitingPayment, now: true, key: 'awaitingPayment' });
  if (report.shipments) {
    builder.kpi({ section: 'Envios UPS', entry: report.shipments.total, period, key: 'shipments.total' });
    const statuses = Object.entries(report.shipments.byStatus || {});
    for (const [status, entry] of statuses) {
      builder.kpi({ section: 'Envios UPS por status', item: SHIPMENT_LABELS[status] || status, entry, period, key: `shipments.byStatus.${status}` });
    }
    if (!statuses.length) builder.push({ section: 'Envios UPS por status', label: 'Nenhum envio no período.', key: 'shipments.byStatus' });
  }
}

const STOCK_COLUMNS = [
  { key: 'produced' },
  { key: 'separated' },
  { key: 'adjusted' },
  { key: 'onHand', now: true },
  { key: 'minLevel', now: true }
];

function stockRows(builder, report) {
  const { period } = report;
  const section = 'Estoque por receita e pack';
  for (const row of report.rows || []) {
    const item = `${itemName(row, report.market)} · ${row.label}`;
    for (const column of STOCK_COLUMNS) {
      const key = `rows.${row.key}.${row.grams}.${column.key}`;
      const below = column.key === 'onHand' && isNumber(row.minLevel) && row.onHand < row.minLevel ? 'abaixo do mínimo' : '';
      builder.push({
        section,
        item,
        label: builder.text(key).label,
        from: column.now ? '' : period && period.from,
        to: column.now ? '' : period && period.to,
        value: measure(row[column.key], 'count'),
        unit: UNIT_LABELS.count,
        note: [column.now ? 'agora' : 'movimento no período', below].filter(Boolean).join(' · '),
        key
      });
    }
  }
  if (!(report.rows || []).length) builder.push({ section, label: 'Nenhum item de estoque.', key: 'rows' });
  for (const column of STOCK_COLUMNS.filter((item) => item.key !== 'minLevel')) {
    builder.kpi({ section: 'Total', entry: report.totals[column.key], now: column.now, period, key: `totals.${column.key}` });
  }
}

const BUILDERS = {
  summary: summaryRows,
  revenue: revenueRows,
  subscriptions: subscriptionsRows,
  acquisition: acquisitionRows,
  mix: mixRows,
  operations: operationsRows,
  stock: stockRows
};

function reportRows(name, report) {
  const build = BUILDERS[name];
  if (!build) {
    throw new HttpError(400, 'Unknown report.', { code: 'report_unknown' });
  }
  const builder = createRows(TAB_LABELS[name], name);
  if (name !== 'summary') {
    headerRows(builder, report, { snapshotNote: name === 'mix' ? 'Retrato das assinaturas ativas agora; o período escolhido não se aplica.' : '' });
  }
  build(builder, report);
  return builder.rows;
}

// Rows to file text: every cell quoted, the format's separator and decimal, formula-like text escaped.
function serializeCsv(rows, format = 'excel') {
  const options = FORMATS[resolveCsvFormat(format)];
  const lines = rows.map((row) => row
    .map((cell) => `"${formatCell(cell, options).replace(/"/g, '""')}"`)
    .join(options.separator));
  return `${options.bom}${lines.join('\r\n')}\r\n`;
}

function toReportCsv(name, report, format = 'excel') {
  return serializeCsv([HEADER, ...reportRows(name, report)], format);
}

function reportFilename(name, market, from, to) {
  return `eden-${name}-${market}-${from}-${to}.csv`;
}

module.exports = {
  formatCell,
  reportFilename,
  resolveCsvFormat,
  serializeCsv,
  toReportCsv
};
