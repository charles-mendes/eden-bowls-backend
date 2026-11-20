const { HttpError } = require('../core/http-error');
const { isAdminIdentity, requireSingleReportMarket } = require('../core/admin-market-scope');
const { localDate, localMidnightUtc, publicPeriod, resolveReportPeriod } = require('../core/report-period');
const { toMinor } = require('../core/report-mrr');
const { serializeCsv, resolveCsvFormat } = require('../core/report-csv');
const { groupLabel, hasPrevious, resolveIndicator } = require('../core/report-indicators');
const { MARKET_MONEY } = require('./admin-reports.service');

const CSV_MAX_RECORDS = 50000;
const CSV_BATCH = 5000;
const EXCLUDED_PREVIEW = 50;
const MARKET_NAMES = { BR: 'Brasil', US: 'EUA' };
const SUBSCRIBERS_PERMISSION = 'billing.subscribers.read';
const DAY_MS = 24 * 60 * 60 * 1000;

// What one record of each source is, in the words of the formula ("Contagem de faturas").
const NOUNS = {
  invoices: 'faturas',
  subscriptions: 'assinaturas',
  mrr: 'assinaturas',
  checkouts: 'checkouts',
  lineItems: 'assinaturas',
  cycles: 'ciclos',
  awaiting: 'assinaturas',
  shipments: 'envios',
  movements: 'movimentos'
};
const MEASURE_LABELS = { amount: 'valor pago', packs: 'pacotes por entrega', matchPacks: 'pacotes por entrega', effect: 'quantidade movimentada', price: 'preço mensal' };
const MONEY_MEASURES = new Set(['amount', 'price']);

const toMysql = (instant) => new Date(instant).toISOString().slice(0, 19).replace('T', ' ');
const fromMysql = (text) => Date.parse(`${String(text).replace(' ', 'T')}Z`);
const ratio = (numerator, denominator) => (denominator ? Math.round((numerator / denominator) * 10000) / 10000 : null);
const average = (total, count) => (count ? Math.round(total / count) : null);
const num = (value) => (value == null || value === '' ? null : Number(value));

function formatDay(date) {
  if (!date) return '';
  const [year, month, day] = String(date).slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function nextDay(date) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function invalidBucket() {
  return new HttpError(400, 'That point is not in the series of this report.', { code: 'report_bucket_invalid' });
}

// Reads the records behind one figure of the admin Reports page, with the same criteria as the figure,
// and checks that they add up to it. Read-only.
class AdminReportDetailsService {
  constructor(options = {}) {
    this.reportsService = options.reportsService;
    this.repository = options.repository;
    this.logger = options.logger || null;
  }

  // Indicator, market, window and the consolidated figure the records must add up to.
  async resolve(query = {}, marketQuery = {}, actor = {}) {
    const entry = resolveIndicator(query.report, query.indicator);
    if (entry.adminOnly && !isAdminIdentity(actor)) {
      throw new HttpError(400, 'Unknown indicator for this report.', { code: 'report_indicator_unknown' });
    }
    const market = requireSingleReportMarket(marketQuery);
    const previous = query.period === 'previous';
    if (previous && !hasPrevious(entry)) {
      throw new HttpError(400, 'This figure has no previous period.', { code: 'report_detail_no_previous' });
    }
    const hasBucket = query.bucket != null && query.bucket !== '';
    if (hasBucket && !entry.series) {
      throw invalidBucket();
    }

    const report = await this.reportsService.report(entry.report, query, { markets: [market] }, actor);
    // The same instant the report used, so a window ending today is cut at the same time.
    const now = new Date(report.generatedAt);
    const period = resolveReportPeriod(query, { market, now });
    const bucket = hasBucket ? (report.series || []).find((item) => item.key === String(query.bucket)) : null;
    if (hasBucket && !bucket) {
      throw invalidBucket();
    }

    const value = entry.value(report, { previous, bucket });
    if (value === undefined) {
      throw new HttpError(400, 'Unknown indicator for this report.', { code: 'report_indicator_unknown' });
    }

    let range = previous ? period.previousRange : period.range;
    let dates = previous ? period.previous : { from: period.from, to: period.to };
    if (bucket) {
      const start = toMysql(Math.max(localMidnightUtc(bucket.from, period.timezone), fromMysql(period.range.start)));
      const end = toMysql(Math.min(localMidnightUtc(nextDay(bucket.to), period.timezone), fromMysql(period.range.end)));
      range = { start, end };
      dates = { from: bucket.from, to: bucket.to };
    }

    return { entry, market, money: MARKET_MONEY[market], report, now, period, previous, bucket, range, dates, value, actor };
  }

  sourceArgs(ctx) {
    const { entry, market, money, range, dates, period, now } = ctx;
    const extra = { ...(entry.source && entry.source.args) };
    const base = {
      invoices: { account: money.account, currency: money.currency, range },
      subscriptions: { account: money.account, range, now: toMysql(now), in7d: toMysql(now.getTime() + 7 * DAY_MS) },
      checkouts: { market, account: money.account, range },
      lineItems: { account: money.account },
      cycles: { account: money.account, from: dates.from, to: dates.to, today: period.today },
      awaiting: { account: money.account },
      shipments: { account: money.account, range },
      movements: { market, range: extra.allTime ? null : range }
    }[entry.source.name];
    delete extra.allTime;
    return { ...base, ...extra };
  }

  // The figure recomputed from its records: a sum, a count, or the average / rate of two sums.
  combine(entry, totals) {
    if (entry.combine === 'average') return average(totals.numerator, totals.denominator);
    if (entry.combine === 'ratio') return ratio(totals.numerator, totals.denominator);
    return totals.contribution;
  }

  async records(ctx, page) {
    const { entry } = ctx;
    if (entry.config) {
      return { sourceName: 'config', rows: [], total: 0, totals: { count: 0 }, groups: [], excluded: [] };
    }
    if (entry.mrr) {
      return this.mrrRecords(ctx, page);
    }
    const args = this.sourceArgs(ctx);
    const name = entry.source.name;
    const [rows, summary, excluded] = await Promise.all([
      page ? this.repository.detailRecords(name, args, entry.measures, page) : [],
      this.repository.detailTotals(name, args, entry.measures),
      Promise.all((entry.excluded || []).map(async (rule) => {
        const excludedArgs = { ...args, ...rule.source.args };
        const [items, counted] = await Promise.all([
          this.repository.detailRecords(rule.source.name, excludedArgs, { contribution: 'one' }, { limit: page ? EXCLUDED_PREVIEW : CSV_MAX_RECORDS, offset: 0 }),
          this.repository.detailTotals(rule.source.name, excludedArgs, { contribution: 'one' })
        ]);
        return { reason: rule.reason, sourceName: rule.source.name, count: counted.totals.count, rows: items };
      }))
    ]);
    return { sourceName: name, rows, total: summary.totals.count, totals: summary.totals, groups: summary.groups, excluded, args };
  }

  // MRR is summed in Node (report-mrr), so its records are classified the same way here.
  async mrrRecords(ctx, page) {
    const rows = await this.repository.recurringPrices({ account: ctx.money.account });
    const classify = (row) => {
      if (row.status === 'trialing') return 'trialing';
      return toMinor(row.subtotal) === null ? 'unpriced' : 'priced';
    };
    const pick = ctx.entry.mrr;
    const chosen = rows.filter((row) => classify(row) === pick).map((row) => ({
      ...row,
      groupKey: row.status,
      price: pick === 'priced' ? toMinor(row.subtotal) : null,
      contribution: pick === 'priced' ? toMinor(row.subtotal) : 1
    }));
    const groups = new Map();
    for (const row of chosen) {
      const group = groups.get(row.groupKey) || { key: row.groupKey, count: 0, contribution: 0 };
      group.count += 1;
      group.contribution += row.contribution;
      groups.set(row.groupKey, group);
    }
    const reasons = { trialing: 'Em teste: ainda não cobra', unpriced: 'Sem preço mensal guardado no plano' };
    const excluded = pick === 'priced'
      ? ['trialing', 'unpriced'].map((kind) => {
        const list = rows.filter((row) => classify(row) === kind).map((row) => ({ ...row, groupKey: row.status, contribution: 1 }));
        return { reason: reasons[kind], sourceName: 'mrr', count: list.length, rows: page ? list.slice(0, EXCLUDED_PREVIEW) : list };
      })
      : [];
    return {
      sourceName: 'mrr',
      rows: page ? chosen.slice(page.offset, page.offset + page.limit) : [],
      allRows: chosen,
      total: chosen.length,
      totals: { count: chosen.length, contribution: chosen.reduce((sum, row) => sum + row.contribution, 0) },
      groups: [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)),
      excluded
    };
  }

  canSeeCustomers(actor) {
    return Boolean(actor && Array.isArray(actor.permissions) && actor.permissions.includes(SUBSCRIBERS_PERMISSION));
  }

  async names(actor, rows) {
    if (!this.canSeeCustomers(actor) || !rows.length) return {};
    return this.repository.customerNames(rows.map((row) => row.userId));
  }

  // One record as the screen shows it: reference, description, link and what it adds to the figure.
  shape(sourceName, row, ctx, names) {
    const tz = ctx.period.timezone;
    const day = (instant) => (instant ? formatDay(localDate(Date.parse(instant), tz)) : '');
    const id = Number(row.id);
    const userId = row.userId == null ? null : Number(row.userId);
    const subscriptionId = row.subscriptionId == null ? null : Number(row.subscriptionId);
    const group = { key: row.groupKey == null ? '' : String(row.groupKey), label: groupLabel(sourceName, row.groupKey == null ? '' : String(row.groupKey)) };
    const subscriptionLink = subscriptionId ? `/billing/subscriptions/${subscriptionId}` : null;
    let reference;
    let description;
    let link = subscriptionLink;
    let approximateDate = false;
    switch (sourceName) {
      case 'invoices':
        reference = row.invoiceNumber || `Fatura #${id}`;
        description = `${group.label} · emitida em ${day(row.date)} · ${String(row.currency || '').toUpperCase()}`;
        link = subscriptionLink || (userId ? `/users/${userId}` : null);
        break;
      case 'subscriptions': {
        reference = `Assinatura #${id}`;
        const parts = [`Status: ${group.label}`];
        if (row.activatedAt) parts.push(`ativou em ${day(row.activatedAt)}${Number(row.activatedApproximate) ? ' (aproximada)' : ''}`);
        if (row.canceledAt) parts.push(`terminou em ${day(row.canceledAt)}${Number(row.canceledApproximate) ? ' (aproximada)' : ''}`);
        if (row.currentPeriodEnd) parts.push(`fim do período atual em ${day(row.currentPeriodEnd)}`);
        if (Number(row.cancelAtPeriodEnd)) parts.push('cancelamento agendado');
        if (Number(row.churned)) parts.push('cancelou no período');
        description = parts.join(' · ');
        approximateDate = Boolean(Number(row.activatedApproximate) || Number(row.canceledApproximate));
        link = `/billing/subscriptions/${id}`;
        break;
      }
      case 'mrr':
        reference = `Assinatura #${id}`;
        description = row.price != null ? `Status: ${group.label} · preço mensal do plano` : `Status: ${group.label}`;
        link = `/billing/subscriptions/${id}`;
        break;
      case 'checkouts':
        reference = `Checkout #${id}`;
        description = `Criado em ${day(row.date)} · etapa atingida: ${group.label}`;
        link = userId ? `/users/${userId}` : null;
        break;
      case 'lineItems':
        reference = `Assinatura #${id}`;
        description = `Status: ${group.label} · itens por ciclo: ${row.items || '—'}`;
        break;
      case 'cycles':
        reference = `Ciclo #${id}`;
        description = [`Status: ${group.label}`, `preparo em ${formatDay(row.preparationDay)}`, `entrega em ${formatDay(row.deliveryDate)}`,
          ...(Number(row.late) ? ['atrasado'] : [])].join(' · ');
        break;
      case 'awaiting':
        reference = `Assinatura #${id}`;
        description = `Status: ${group.label} · renovação de ${day(row.date)} ainda não paga`;
        break;
      case 'shipments':
        reference = `Envio #${id}`;
        description = [group.label, row.trackingNumber ? `rastreio ${row.trackingNumber}` : 'sem rastreio', `criado em ${day(row.date)}`].join(' · ');
        break;
      case 'movements':
        reference = `Movimento #${id}`;
        description = [`${group.label} de ${Number(row.quantity)}`, `${row.flavorKey} ${row.grams} g`, ...(row.reason ? [row.reason] : [])].join(' · ');
        link = '/operations/stock';
        break;
      default:
        reference = `#${id}`;
        description = '';
    }
    const record = {
      id,
      type: sourceName,
      reference,
      date: row.date || null,
      description,
      group,
      link,
      ...(row.contribution !== undefined ? { contribution: num(row.contribution) } : {}),
      ...(row.numerator !== undefined ? { numerator: num(row.numerator), denominator: num(row.denominator) } : {}),
      ...(approximateDate ? { approximateDate: true } : {})
    };
    if (names && userId && Object.prototype.hasOwnProperty.call(names, userId)) {
      record.customer = { name: names[userId], link: `/users/${userId}` };
    }
    return record;
  }

  criteria(ctx) {
    const { entry, market, money, period, previous, bucket, dates } = ctx;
    const marketLine = `Mercado ${MARKET_NAMES[market] || market} (${market}): conta Stripe ${money.account}, moeda ${money.code}.`;
    let windowLine;
    if (entry.pointInTime) {
      windowLine = `Retrato de agora, gerado em ${ctx.report.generatedAt} (UTC).`;
    } else if (bucket) {
      windowLine = `Ponto do gráfico: ${formatDay(dates.from)} a ${formatDay(dates.to)} (${period.timezone})${bucket.partial ? ', período parcial' : ''}.`;
    } else {
      const label = previous ? 'Período anterior' : 'Janela';
      windowLine = `${label}: ${formatDay(dates.from)} a ${formatDay(dates.to)} (${period.timezone})${period.partialToday ? ', hoje até o mesmo horário' : ''}.`;
    }
    return [marketLine, windowLine, ...(entry.criteria || [])];
  }

  formula(ctx, result, recordsValue) {
    const { entry } = ctx;
    const noun = NOUNS[result.sourceName] || 'registros';
    if (entry.config) {
      return { expression: 'Valor configurado no item de estoque', terms: [], result: ctx.value };
    }
    if (entry.combine) {
      const unit = entry.combine === 'average' ? 'money' : 'count';
      return {
        expression: `${entry.formula.numerator} ÷ ${entry.formula.denominator}`,
        terms: [
          { label: entry.formula.numerator, value: result.totals.numerator, kind: unit },
          { label: entry.formula.denominator, value: result.totals.denominator, kind: 'count' }
        ],
        result: recordsValue
      };
    }
    const measure = entry.mrr ? (entry.mrr === 'priced' ? 'price' : 'one') : entry.measures.contribution;
    if (measure === 'one') {
      return { expression: `Contagem de ${noun}`, terms: [{ label: `${noun[0].toUpperCase()}${noun.slice(1)}`, value: result.totals.count, kind: 'count' }], result: recordsValue };
    }
    return {
      expression: `Soma do ${MEASURE_LABELS[measure] || 'valor'} de ${result.totals.count} ${noun}`,
      terms: [{ label: `${noun[0].toUpperCase()}${noun.slice(1)}`, value: result.totals.count, kind: 'count' }],
      result: recordsValue
    };
  }

  contributionKind(entry) {
    if (entry.mrr === 'priced') return 'money';
    if (entry.combine) return null;
    return entry.measures && MONEY_MEASURES.has(entry.measures.contribution) ? 'money' : 'count';
  }

  // Same figure from two paths; a gap is shown and logged, never adjusted.
  reconcile(ctx, recordsValue) {
    const matches = ctx.entry.config ? true : recordsValue === ctx.value;
    if (!matches && this.logger && typeof this.logger.error === 'function') {
      this.logger.error({
        report: ctx.entry.report,
        indicator: ctx.entry.key,
        market: ctx.market,
        window: { ...ctx.range, previous: ctx.previous, bucket: ctx.bucket ? ctx.bucket.key : null },
        reportValue: ctx.value,
        recordsValue
      }, 'Report details do not add up to the report figure.');
    }
    return { reportValue: ctx.value, recordsValue: ctx.entry.config ? ctx.value : recordsValue, matches };
  }

  async build(ctx, result, rows, names) {
    const { entry } = ctx;
    const recordsValue = entry.config ? ctx.value : this.combine(entry, result.totals);
    const excludedRows = result.excluded.flatMap((rule) => rule.rows);
    const excludedNames = await this.names(ctx.actor, excludedRows);
    const item = entry.item ? entry.item(ctx.report) : null;
    return {
      report: entry.requestedReport,
      indicator: entry.requestedKey,
      source: { report: entry.report, indicator: entry.key },
      label: entry.label,
      title: item ? `${entry.label} · ${item}` : entry.label,
      description: entry.description,
      kind: entry.kind,
      contributionKind: this.contributionKind(entry),
      market: ctx.market,
      currency: ctx.money.code,
      pointInTime: Boolean(entry.pointInTime),
      hasPrevious: hasPrevious(entry),
      period: publicPeriod(ctx.period),
      window: {
        from: entry.pointInTime ? null : ctx.dates.from,
        to: entry.pointInTime ? null : ctx.dates.to,
        timezone: ctx.period.timezone,
        previous: ctx.previous,
        bucket: ctx.bucket ? { key: ctx.bucket.key, from: ctx.bucket.from, to: ctx.bucket.to, partial: Boolean(ctx.bucket.partial) } : null
      },
      value: ctx.value,
      criteria: this.criteria(ctx),
      formula: this.formula(ctx, result, recordsValue),
      groups: result.groups.map((group) => ({ ...group, label: groupLabel(result.sourceName, group.key) })),
      totals: result.totals,
      excluded: result.excluded.map((rule) => ({
        reason: rule.reason,
        count: rule.count,
        // Listed for the check, never added: an excluded record carries no contribution.
        items: rule.rows.map((row) => {
          const { contribution, ...record } = this.shape(rule.sourceName, row, ctx, excludedNames);
          return record;
        })
      })),
      reconciliation: this.reconcile(ctx, recordsValue),
      generatedAt: ctx.report.generatedAt,
      records: rows.map((row) => this.shape(result.sourceName, row, ctx, names))
    };
  }

  async details(query = {}, marketQuery = {}, actor = {}, page = { page: 1, perPage: 50, offset: 0 }) {
    const ctx = await this.resolve(query, marketQuery, actor);
    const result = await this.records(ctx, { limit: page.perPage, offset: page.offset });
    const names = await this.names(actor, result.rows);
    const body = await this.build(ctx, result, result.rows, names);
    const { records, ...rest } = body;
    return { ...rest, records: { items: records, page: page.page, perPage: page.perPage, total: result.total } };
  }

  // Every record in one file, read in batches; above the cap the caller is asked to shorten the window.
  async exportCsv(query = {}, marketQuery = {}, actor = {}) {
    const format = resolveCsvFormat(query.formato);
    const ctx = await this.resolve(query, marketQuery, actor);
    const result = await this.records(ctx, null);
    if (result.total > CSV_MAX_RECORDS) {
      throw new HttpError(413, `The details have ${result.total} records; the file holds at most ${CSV_MAX_RECORDS}. Choose a shorter period.`, {
        code: 'report_detail_too_large',
        total: result.total
      });
    }
    let rows = [];
    if (result.allRows) {
      rows = result.allRows;
    } else if (result.args) {
      for (let offset = 0; offset < result.total; offset += CSV_BATCH) {
        rows = rows.concat(await this.repository.detailRecords(result.sourceName, result.args, ctx.entry.measures, { limit: CSV_BATCH, offset }));
      }
    }
    const names = await this.names(actor, rows);
    const body = await this.build(ctx, result, rows, names);
    const window = ctx.entry.pointInTime ? { from: ctx.period.from, to: ctx.period.to } : ctx.dates;
    const slug = String(body.indicator).replace(/[^A-Za-z0-9_-]+/g, '-');
    return {
      csv: serializeCsv(detailCsvRows(body), format),
      filename: `eden-${body.report}-${slug}-${ctx.market}-${window.from}-${window.to}.csv`
    };
  }
}

const CSV_HEADER = ['Bloco', 'Referência', 'Data', 'Grupo', 'Descrição', 'Cliente', 'Valor', 'Numerador', 'Denominador', 'Unidade', 'Moeda', 'Observação'];
const UNITS = { money: 'dinheiro', count: 'quantidade', rate: '%' };

function csvValue(value, kind) {
  if (value == null) return null;
  if (kind === 'money') return { money: value };
  if (kind === 'rate') return Math.round(value * 1000) / 10;
  return value;
}

// The details as rows: the figure, its criteria and formula, every record, the excluded ones, subtotals,
// the total and the check against the report.
function detailCsvRows(body) {
  const rows = [CSV_HEADER];
  const currency = (kind) => (kind === 'money' ? body.currency : '');
  const line = (block, values = {}) => rows.push([
    block, values.reference || '', values.date || '', values.group || '', values.description || '', values.customer || '',
    values.value === undefined ? null : values.value, values.numerator === undefined ? null : values.numerator,
    values.denominator === undefined ? null : values.denominator, values.unit || '', values.currency || '', values.note || ''
  ]);
  const windowText = body.pointInTime ? 'agora' : `${formatDay(body.window.from)} a ${formatDay(body.window.to)}`;
  const valueKind = body.kind;
  const recordKind = body.contributionKind;
  const ratioKinds = body.formula.terms.map((term) => term.kind);

  line('Indicador', { reference: body.title, description: body.description, value: csvValue(body.value, valueKind), unit: UNITS[valueKind], currency: currency(valueKind),
    note: `${MARKET_NAMES[body.market] || body.market} (${body.market}) · ${windowText}${body.window.previous ? ' · período anterior' : ''}${body.window.bucket ? ' · ponto do gráfico' : ''}` });
  for (const text of body.criteria) line('Critério', { description: text });
  line('Fórmula', { description: body.formula.expression, value: csvValue(body.formula.result, valueKind), unit: UNITS[valueKind], currency: currency(valueKind) });

  const recordLine = (block, record, note = '') => line(block, {
    reference: record.reference,
    date: record.date,
    group: record.group.label,
    description: record.description,
    customer: record.customer ? record.customer.name : '',
    value: recordKind && record.contribution !== undefined ? csvValue(record.contribution, recordKind) : null,
    numerator: record.numerator !== undefined ? csvValue(record.numerator, ratioKinds[0]) : undefined,
    denominator: record.denominator !== undefined ? csvValue(record.denominator, ratioKinds[1]) : undefined,
    unit: recordKind ? UNITS[recordKind] : '',
    currency: recordKind ? currency(recordKind) : (ratioKinds[0] === 'money' ? body.currency : ''),
    note: [note, record.approximateDate ? 'data aproximada' : ''].filter(Boolean).join(' · ')
  });
  for (const record of body.records) recordLine('Registro', record);
  for (const rule of body.excluded) {
    for (const record of rule.items) recordLine('Excluído', { ...record, contribution: undefined }, rule.reason);
  }
  for (const group of body.groups) {
    line('Subtotal', {
      group: group.label,
      description: `${group.count} registro(s)`,
      value: recordKind ? csvValue(group.contribution, recordKind) : null,
      numerator: group.numerator !== undefined ? csvValue(group.numerator, ratioKinds[0]) : undefined,
      denominator: group.denominator !== undefined ? csvValue(group.denominator, ratioKinds[1]) : undefined,
      unit: recordKind ? UNITS[recordKind] : '',
      currency: recordKind ? currency(recordKind) : ''
    });
  }
  line('Total', {
    description: `${body.totals.count} registro(s)`,
    value: csvValue(body.reconciliation.recordsValue, valueKind),
    numerator: body.totals.numerator !== undefined ? csvValue(body.totals.numerator, ratioKinds[0]) : undefined,
    denominator: body.totals.denominator !== undefined ? csvValue(body.totals.denominator, ratioKinds[1]) : undefined,
    unit: UNITS[valueKind],
    currency: currency(valueKind)
  });
  line('Conferência', {
    description: body.reconciliation.matches ? 'A soma dos registros confere com o relatório.' : 'A soma dos registros não confere com o relatório.',
    value: csvValue(body.reconciliation.reportValue, valueKind),
    unit: UNITS[valueKind],
    currency: currency(valueKind),
    note: body.reconciliation.matches ? 'confere' : `diverge: registros somam ${body.reconciliation.recordsValue}`
  });
  return rows;
}

module.exports = {
  AdminReportDetailsService,
  CSV_MAX_RECORDS
};
