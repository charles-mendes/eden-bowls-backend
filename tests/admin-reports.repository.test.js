const { AdminReportsRepository, QUERY_HINT } = require('../src/infrastructure/repositories/admin-reports.repository');

const range = { start: '2026-09-28 03:00:00', end: '2026-10-28 03:00:00' };

function repository(result = [{}]) {
  const query = jest.fn().mockResolvedValue(result);
  return { query, repo: new AdminReportsRepository({ isInitialized: true, query }) };
}

async function everyQuery() {
  const { query, repo } = repository([]);
  await repo.invoiceTotals({ account: 'br', currency: 'brl', range });
  await repo.invoiceSeries({ account: 'br', currency: 'brl', range });
  await repo.recurringPrices({ account: 'br' });
  await repo.subscriptionSnapshot({ account: 'br', now: range.end, in7d: range.end });
  await repo.subscriptionPeriod({ account: 'br', range });
  await repo.subscriptionSeries({ account: 'br', range });
  await repo.acquisitionTotals({ market: 'BR', account: 'br', range });
  await repo.acquisitionSeries({ market: 'BR', range });
  await repo.mixByRecipe({ account: 'br' });
  await repo.mixByPackSize({ account: 'br' });
  await repo.cyclesByStatus({ account: 'br', from: '2026-09-28', to: '2026-10-27', today: '2026-10-28' });
  await repo.awaitingPayment({ account: 'br' });
  await repo.shipmentsByStatus({ account: 'us', range });
  await repo.stockRows({ market: 'BR', range });
  return query.mock.calls;
}

describe('AdminReportsRepository', () => {
  test('every query carries the execution limit and a market or account filter', async () => {
    const calls = await everyQuery();
    expect(calls).toHaveLength(14);
    for (const [sql, params] of calls) {
      expect(sql.startsWith(`SELECT ${QUERY_HINT}`)).toBe(true);
      expect(sql).toMatch(/stripe_account = \?|market = \?/);
      expect(params.some((value) => ['br', 'us', 'BR'].includes(value))).toBe(true);
    }
  });

  test('no query selects personal data', async () => {
    for (const [sql] of await everyQuery()) {
      expect(sql).not.toMatch(/customer_email|customer_name|email_to|address|stripe_customer_id|SELECT \*/);
    }
  });

  test('invoice totals sum only the account currency and count the others as excluded', async () => {
    const { query, repo } = repository([{ revenue: '30000', invoices: '2', firstPurchaseRevenue: '15000', firstPurchaseInvoices: '1', excludedInvoices: '1' }]);
    const totals = await repo.invoiceTotals({ account: 'br', currency: 'brl', range });

    expect(totals).toEqual({ revenue: 30000, invoices: 2, firstPurchaseRevenue: 15000, firstPurchaseInvoices: 1, excludedInvoices: 1 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("invoice_status = 'paid'");
    expect(sql).toContain('currency <> ?');
    expect(params).toEqual(['brl', 'brl', 'brl', 'brl', 'brl', 'br', range.start, range.end]);
  });

  test('subscription windows count only activated rows and the churn cohort of the start', async () => {
    const { query, repo } = repository([{ newCount: 3, canceled: 5, activeAtStart: 100, churned: 4 }]);
    const result = await repo.subscriptionPeriod({ account: 'br', range });

    expect(result).toMatchObject({ newCount: 3, canceled: 5, activeAtStart: 100, churned: 4 });
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('activated_at IS NOT NULL');
    expect(sql).toContain('s.activated_at < ? AND (s.canceled_at IS NULL OR s.canceled_at >= ?)');
  });

  test('acquisition stage 3 is activation, not today\'s status', async () => {
    const { query, repo } = repository([{ started: 200, linked: 120, activated: 90 }]);
    expect(await repo.acquisitionTotals({ market: 'BR', account: 'br', range })).toEqual({ started: 200, linked: 120, activated: 90 });
    expect(query.mock.calls[0][0]).toContain('s.activated_at IS NOT NULL');
    expect(query.mock.calls[0][0]).not.toContain("s.status IN");
  });

  test('cycles fold into the four production statuses and count late ones against the local today', async () => {
    const { query, repo } = repository([
      { status: 'in_production', cycles: 2, late: 1 },
      { status: 'ready', cycles: 5, late: 0 }
    ]);
    const result = await repo.cyclesByStatus({ account: 'br', from: '2026-09-28', to: '2026-10-27', today: '2026-10-28' });

    expect(result).toEqual({ byStatus: { to_prepare: 0, in_production: 2, ready: 5, blocked: 0 }, late: 1 });
    expect(query.mock.calls[0][0]).toContain('c.paid_at IS NOT NULL');
    expect(query.mock.calls[0][1][0]).toBe('2026-10-28');
  });

  test('a database timeout becomes report_timeout', async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error('Query execution was interrupted'), { errno: 3024, code: 'ER_QUERY_TIMEOUT' }));
    const repo = new AdminReportsRepository({ isInitialized: true, query });

    await expect(repo.invoiceTotals({ account: 'br', currency: 'brl', range })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'report_timeout' }
    });
  });

  test('a missing table reads as empty', async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error("Table 'pack_stock_items' doesn't exist"), { errno: 1146 }));
    const repo = new AdminReportsRepository({ isInitialized: true, query });
    await expect(repo.stockRows({ market: 'BR', range })).resolves.toEqual([]);
  });
});

describe('AdminReportsRepository details', () => {
  const SOURCES = [
    ['invoices', { account: 'br', currency: 'brl', range, variant: 'paid' }, { contribution: 'amount' }],
    ['invoices', { account: 'br', currency: 'brl', range, variant: 'otherCurrency' }, { contribution: 'one' }],
    ['subscriptions', { account: 'br', range, variant: 'activeAtStart' }, { numerator: 'churned', denominator: 'one' }],
    ['subscriptions', { account: 'br', now: range.end, in7d: range.end, variant: 'renewing7d' }, { contribution: 'one' }],
    ['checkouts', { market: 'BR', account: 'br', range, variant: 'started' }, { numerator: 'activated', denominator: 'one' }],
    ['lineItems', { account: 'br', match: { flavor: 'frango' } }, { numerator: 'matchPacks', denominator: 'packs' }],
    ['cycles', { account: 'br', from: '2026-09-28', to: '2026-10-27', today: '2026-10-28', late: true }, { contribution: 'one' }],
    ['awaiting', { account: 'br' }, { contribution: 'one' }],
    ['shipments', { account: 'us', range, variant: 'status', status: 'delivered' }, { contribution: 'one' }],
    ['movements', { market: 'BR', range, flavor: 'frango', grams: 300, kind: 'separated' }, { contribution: 'effect' }]
  ];

  test('every record query carries the execution limit, the market filter and no personal column', async () => {
    for (const [name, args, measures] of SOURCES) {
      const { query, repo } = repository([]);
      await repo.detailRecords(name, args, measures, { limit: 50, offset: 0 });
      await repo.detailTotals(name, args, measures);
      for (const [sql, params] of query.mock.calls) {
        expect(sql.startsWith(`SELECT ${QUERY_HINT}`)).toBe(true);
        expect(sql).toMatch(/stripe_account = \?|market = \?/);
        expect(params.some((value) => ['br', 'us', 'BR'].includes(value))).toBe(true);
        expect(sql).not.toMatch(/customer_email|customer_name|email_to|address|stripe_customer_id|display_name|SELECT \*/);
      }
    }
  });

  test('a page is ordered by date then id and paged after the filter', async () => {
    const { query, repo } = repository([]);
    await repo.detailRecords('invoices', SOURCES[0][1], { contribution: 'amount' }, { limit: 50, offset: 100 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ORDER BY t\.date, t\.id LIMIT \? OFFSET \?$/);
    expect(params.slice(-2)).toEqual([50, 100]);
    expect(sql).toContain("i.invoice_status = 'paid'");
    expect(sql).toContain('i.currency = ?');
  });

  test('totals and subtotals run over the whole record set, without paging', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ count: '3', contribution: '45000' }])
      .mockResolvedValueOnce([{ groupKey: 'subscription_create', count: '1', contribution: '15000' }, { groupKey: null, count: '2', contribution: '30000' }]);
    const repo = new AdminReportsRepository({ isInitialized: true, query });
    const result = await repo.detailTotals('invoices', SOURCES[0][1], { contribution: 'amount' });

    expect(result).toEqual({
      totals: { count: 3, contribution: 45000 },
      groups: [{ key: 'subscription_create', count: 1, contribution: 15000 }, { key: '', count: 2, contribution: 30000 }]
    });
    for (const [sql] of query.mock.calls) {
      expect(sql).not.toMatch(/LIMIT \? OFFSET/);
    }
  });

  test('customer names are asked only for valid ids and only by id', async () => {
    const { query, repo } = repository([{ id: '7', name: 'Ana' }]);
    expect(await repo.customerNames([])).toEqual({});
    expect(query).not.toHaveBeenCalled();
    expect(await repo.customerNames([7, '7', null, 'x'])).toEqual({ 7: 'Ana' });
    expect(query.mock.calls[0][1]).toEqual([7]);
    expect(query.mock.calls[0][0]).toContain('u.display_name AS name');
    expect(query.mock.calls[0][0]).not.toMatch(/user_email/);
  });
});
