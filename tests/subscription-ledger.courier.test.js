const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');

const paidRow = { id: 42, stripe_subscription_id: 'sub_br_1', stripe_account: 'br', status: 'active', payment_state: 'paid', paid_invoice_id: 'in_1', production_status: 'ready', delivery_date: '2026-11-05', address: '{"country":"BR"}' };

describe('SubscriptionLedgerRepository courier queries', () => {
  test('listPaidCourierCycles takes the Brazil shipping market, account and address together, with the date floor', async () => {
    const query = jest.fn().mockResolvedValue([paidRow]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const rows = await repository.listPaidCourierCycles({ deliveryFloor: '2026-10-05', limit: 201 });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("(q.stripe_account = 'br' AND UPPER(TRIM(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.country')), ''))) = 'BR')");
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL");
    expect(sql).toContain('COALESCE(q.delivery_date, DATE(q.cycle_period_end)) >= ?');
    expect(params).toEqual(['2026-10-05', 201]);
    expect(rows[0]).toMatchObject({ paidInvoiceId: 'in_1', productionStatus: 'ready', deliveryDate: '2026-11-05' });
  });

  test('listPaidCourierCycles keeps only cycles to dispatch, so boxes that left take no place in the limit', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await repository.listPaidCourierCycles({ deliveryFloor: '2026-10-07', deliveryCeiling: '2026-11-07', limit: 201, courierTableName: 'courier_deliveries' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM `courier_deliveries` cd WHERE cd.stripe_invoice_id COLLATE utf8mb4_unicode_ci = q.paid_invoice_id COLLATE utf8mb4_unicode_ci AND cd.status IN ('out_for_delivery', 'delivered', 'failed'))");
    expect(sql).toContain('COALESCE(q.delivery_date, DATE(q.cycle_period_end)) <= ?');
    expect(params).toEqual(['2026-10-07', '2026-11-07', 201]);
  });

  // simplify-brazil-dispatch: "A despachar" opens on ready cycles; without the flag the query is unchanged.
  test('readyOnly adds the ready status to the courier list and count, and only when asked', async () => {
    const query = jest.fn().mockResolvedValue([{ total: 0 }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await repository.listPaidCourierCycles({ deliveryFloor: '2026-10-07', limit: 201, readyOnly: true });
    await repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-10-07', readyOnly: true });
    await repository.listPaidCourierCycles({ deliveryFloor: '2026-10-07', limit: 201 });
    await repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-10-07' });

    const sqls = query.mock.calls.map(([sql]) => sql);
    expect(sqls[0]).toContain("q.production_status = 'ready'");
    expect(sqls[1]).toContain("q.production_status = 'ready'");
    expect(sqls[2]).not.toContain("q.production_status = 'ready'");
    expect(sqls[3]).not.toContain("q.production_status = 'ready'");
    expect(query.mock.calls[0][1]).toEqual(['2026-10-07', 201]);
  });

  test('countPaidCourierCyclesToDispatch takes the ceiling when given', async () => {
    const query = jest.fn().mockResolvedValue([{ total: 3 }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-10-07', deliveryCeiling: '2026-11-07', stripeAccounts: ['br'] })).resolves.toBe(3);
    expect(query.mock.calls[0][1]).toEqual(['2026-10-07', '2026-11-07', 'br']);
    await repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-11-08' });
    expect(query.mock.calls[1][0]).not.toContain('<= ?');
    expect(query.mock.calls[1][1]).toEqual(['2026-11-08']);
  });

  // admin-flow-fixes-4 (PM-25): the cycles to dispatch whose invoice has no authorized NF-e.
  test('countPaidCourierCyclesToDispatch with nfeTableName keeps the cycles without an authorized NF-e', async () => {
    const query = jest.fn().mockResolvedValue([{ total: 2 }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-10-07', deliveryCeiling: '2026-11-07', nfeTableName: 'bling_nfe' })).resolves.toBe(2);
    expect(query.mock.calls[0][0]).toContain("NOT EXISTS (SELECT 1 FROM `bling_nfe` n WHERE n.stripe_account COLLATE utf8mb4_unicode_ci = q.stripe_account COLLATE utf8mb4_unicode_ci AND n.stripe_invoice_id COLLATE utf8mb4_unicode_ci = q.paid_invoice_id COLLATE utf8mb4_unicode_ci AND n.status = 'authorized')");
    expect(query.mock.calls[0][1]).toEqual(['2026-10-07', '2026-11-07']);
    await repository.countPaidCourierCyclesToDispatch({ deliveryFloor: '2026-10-07' });
    expect(query.mock.calls[1][0]).not.toContain('bling_nfe');
  });

  test('listPaidCyclesByInvoiceIds has no floor and skips an empty list', async () => {
    const query = jest.fn().mockResolvedValue([paidRow]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.listPaidCyclesByInvoiceIds([])).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
    await repository.listPaidCyclesByInvoiceIds(['in_1', 'in_1', 'in_2']);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IN (?, ?)");
    expect(sql).not.toContain('>= ?');
    expect(params).toEqual(['in_1', 'in_2']);
  });

  test('listPaidCyclesBySubscription lists one subscription, newest delivery first, with null dates in place', async () => {
    const query = jest.fn().mockResolvedValue([paidRow]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.listPaidCyclesBySubscription('abc')).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
    const rows = await repository.listPaidCyclesBySubscription('42');

    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL AND q.id = ?");
    expect(sql).toContain('ORDER BY COALESCE(q.delivery_date, DATE(q.cycle_period_end)) DESC');
    expect(params).toEqual([42, 24]);
    expect(rows[0]).toMatchObject({ paidInvoiceId: 'in_1' });
  });
});
