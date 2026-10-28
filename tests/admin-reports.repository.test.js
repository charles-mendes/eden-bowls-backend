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
    expect(sql).toContain('activated_at < ? AND (canceled_at IS NULL OR canceled_at >= ?)');
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
