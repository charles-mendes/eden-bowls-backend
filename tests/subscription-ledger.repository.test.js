const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');

describe('SubscriptionLedgerRepository', () => {
  test('lists rows for a user id', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        id: 1,
        user_id: 7,
        stripe_subscription_id: 'sub_123',
        stripe_customer_id: 'cus_1',
        status: 'active',
        plan_label: 'Plan #1',
        cancel_at_period_end: 0,
        edit_payment_pending: 0
      }
    ]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const rows = await repository.listByUserId(7);
    expect(rows).toHaveLength(1);
    expect(rows[0].stripeSubscriptionId).toBe('sub_123');
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE s.`user_id` = ?'), [7]);
  });

  test('upserts by stripe_subscription_id', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([{
        id: 1,
        user_id: 7,
        stripe_subscription_id: 'sub_123',
        stripe_customer_id: 'cus_1',
        status: 'incomplete',
        cancel_at_period_end: 0,
        edit_payment_pending: 0
      }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const row = await repository.upsert({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      status: 'incomplete'
    });

    expect(row.status).toBe('incomplete');
    expect(query.mock.calls[1][0]).toContain('INSERT INTO');
  });

  function upsertRepository(existing = null) {
    const query = jest.fn(async (sql) => {
      if (sql.includes('INSERT INTO')) return { affectedRows: 1 };
      return existing ? [existing] : [];
    });
    return { query, repository: new SubscriptionLedgerRepository({ isInitialized: true, query }) };
  }

  function lifecycleParams(query) {
    const call = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO'));
    return { sql: call[0], activatedAt: call[1][20], canceledAt: call[1][21] };
  }

  const base = { userId: 7, stripeSubscriptionId: 'sub_123', stripeCustomerId: 'cus_1' };

  test('an active row proposes an activation date that the upsert never overwrites', async () => {
    const { query, repository } = upsertRepository();
    await repository.upsert({ ...base, status: 'active' });
    const { sql, activatedAt, canceledAt } = lifecycleParams(query);

    expect(activatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(canceledAt).toBeNull();
    expect(sql).toContain('`activated_at` = COALESCE(`activated_at`, VALUES(`activated_at`))');
  });

  test('an incomplete row never activates', async () => {
    const { query, repository } = upsertRepository();
    await repository.upsert({ ...base, status: 'incomplete' });
    expect(lifecycleParams(query).activatedAt).toBeNull();
  });

  test('a cancellation request leaves the end date empty', async () => {
    const { query, repository } = upsertRepository();
    await repository.upsert({ ...base, status: 'active', cancelAtPeriodEnd: true, endedAt: 1791640800 });
    expect(lifecycleParams(query).canceledAt).toBeNull();
  });

  test('checkout-history: the checkout snapshot is written once and never overwritten', async () => {
    const { query, repository } = upsertRepository();
    const snapshot = { version: 1, source: 'checkout', checkout_reference: { stripe_subscription_id: 'sub_123' } };
    await repository.upsert({ ...base, status: 'incomplete', checkoutSnapshot: snapshot });
    const call = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO'));

    expect(call[1][22]).toBe(JSON.stringify(snapshot));
    expect(call[0]).toContain('`checkout_snapshot` = COALESCE(`checkout_snapshot`, VALUES(`checkout_snapshot`))');
  });

  test('checkout-history: a webhook upsert sends no snapshot even when the row has one', async () => {
    const { query, repository } = upsertRepository({
      id: 1,
      user_id: 7,
      stripe_subscription_id: 'sub_123',
      stripe_customer_id: 'cus_1',
      status: 'incomplete',
      checkout_snapshot: JSON.stringify({ version: 1, source: 'checkout' })
    });
    await repository.upsert({ ...base, status: 'active' });
    const call = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO'));

    expect(call[1][22]).toBeNull();
  });

  test('a canceled row stores Stripe ended_at and keeps the first stored date', async () => {
    const { query, repository } = upsertRepository();
    await repository.upsert({ ...base, status: 'canceled', endedAt: 1791640800 });
    const { sql, canceledAt } = lifecycleParams(query);

    expect(canceledAt).toBe('2026-10-10 14:00:00');
    expect(sql).toContain("`canceled_at` = IF(VALUES(`status`) = 'canceled', COALESCE(`canceled_at`, VALUES(`canceled_at`)), NULL)");
  });

  test('a row that is no longer canceled clears the end date and its approximate flag', async () => {
    const { query, repository } = upsertRepository();
    await repository.upsert({ ...base, status: 'active' });
    const { sql } = lifecycleParams(query);
    expect(sql).toContain("`canceled_at_approximate` = IF(VALUES(`status`) = 'canceled', `canceled_at_approximate`, 0)");
  });

  test('returns an empty list when the table is missing', async () => {
    const query = jest.fn().mockRejectedValue(Object.assign(new Error("Table 'stripe_subscriptions' doesn't exist"), {
      code: 'ER_NO_SUCH_TABLE',
      errno: 1146
    }));
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await expect(repository.listByUserId(7)).resolves.toEqual([]);
  });

  test('lists production queue membership with civil bounds, CAPE exclusion, overdue cap, and stable order', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        id: 42,
        user_id: 7,
        customer_email: 'ana@edenbowls.com',
        stripe_subscription_id: 'sub_123',
        stripe_customer_id: 'cus_1',
        stripe_account: 'br',
        status: 'active',
        plan_label: 'Plano adulto',
        current_period_end: '2026-09-20 08:00:00',
        cancel_at_period_end: 0,
        production_status: 'to_prepare',
        production_note: null,
        profile_market: 'BR'
      }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const result = await repository.listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      account: 'br',
      productionStatus: 'to_prepare',
      q: 'ana@',
      offset: 0,
      perPage: 20
    });

    expect(result.total).toBe(1);
    expect(result.items[0].productionStatus).toBe('to_prepare');
    const sql = query.mock.calls[1][0];
    expect(sql).toContain("s.status IN ('active','trialing','past_due')");
    // The unpaid cycle excludes cancel_at_period_end; a paid cycle (second branch) does not look at it.
    expect(sql).toContain("(s.status = 'past_due' OR s.cancel_at_period_end = 0)");
    expect(sql).toContain('UNION ALL');
    expect(sql).toContain('WHERE c.paid_at IS NOT NULL');
    expect(sql).toContain('ORDER BY q.due_at ASC, q.id ASC');
    expect(sql).toContain('LEFT JOIN `subscription_production_cycles`');
    expect(sql).toContain('hsr_market_country');
    // operator-fills-recipient-name: the account name, which the presenter keeps only for a profile in scope.
    expect(sql).toContain('LEFT JOIN `wp_users` u ON u.ID = q.user_id');
    expect(sql).toContain('u.display_name AS account_display_name');
    expect(sql).not.toContain('payment_method_last4');
  });

  test('queue search also matches the address name keys the queue shows', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      q: 'Souza',
      offset: 0,
      perPage: 20
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('q.customer_email LIKE ?');
    for (const key of ['recipient_name', 'name', 'full_name', 'recipient']) {
      expect(sql).toContain(`LOWER(JSON_UNQUOTE(JSON_EXTRACT(q.address, '$.${key}'))) LIKE LOWER(?)`);
    }
    // Four id columns, four address keys and the account name (no market limit for an unscoped caller).
    expect(sql).toContain('LOWER(u.display_name) LIKE LOWER(?)');
    expect(params.filter((value) => value === '%Souza%')).toHaveLength(9);
  });

  test('queue search matches the account name only for a profile in the given markets', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      q: 'Costa',
      nameMarkets: ['BR'],
      offset: 0,
      perPage: 20
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('(LOWER(u.display_name) LIKE LOWER(?) AND UPPER(TRIM(pm.meta_value)) IN (?))');
    expect(params).toContain('BR');
  });

  test('fills the recipient only when the address has none', async () => {
    const query = jest.fn().mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce({ affectedRows: 0 });
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    expect(await repository.fillAddressRecipientName(200, 'Ana Costa')).toBe(true);
    expect(await repository.fillAddressRecipientName(200, 'Ana Costa')).toBe(false);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("JSON_SET(COALESCE(`address`, JSON_OBJECT()), '$.recipient_name', ?)");
    expect(sql).toContain("COALESCE(TRIM(JSON_UNQUOTE(JSON_EXTRACT(`address`, '$.recipient_name'))), '') = ''");
    expect(params).toEqual(['Ana Costa', 200]);
  });

  test('erasure removes the delivery instructions from every subscription address of the user', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 2 });
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    expect(await repository.clearDeliveryInstructionsForUser(77)).toBe(2);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("JSON_REMOVE(`address`, '$.delivery_instructions')");
    expect(params).toEqual([77]);
  });

  test('sets only the delivery instructions key of one subscription address', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 1 });
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    expect(await repository.setAddressDeliveryInstructions(200, 'Portão lateral')).toBe(true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("JSON_SET(COALESCE(`address`, JSON_OBJECT()), '$.delivery_instructions', ?)");
    expect(sql).toContain('WHERE `id` = ?');
    expect(params).toEqual(['Portão lateral', 200]);
  });

  test('narrows the queue to one civil-day due bucket', async () => {
    const bounds = {
      startOfToday: '2026-09-20 03:00:00',
      startOfTomorrow: '2026-09-21 03:00:00',
      startOfDayAfterTomorrow: '2026-09-22 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    };
    const run = async (due) => {
      const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await new SubscriptionLedgerRepository({ isInitialized: true, query }).listQueue({ ...bounds, due });
      return { sql: query.mock.calls[0][0], params: query.mock.calls[0][1] };
    };

    const today = await run('today');
    expect(today.sql).toContain('q.due_at >= ? AND q.due_at < ?');
    expect(today.params.slice(-2)).toEqual(['2026-09-20 03:00:00', '2026-09-21 03:00:00']);
    expect((await run('tomorrow')).params.slice(-2)).toEqual(['2026-09-21 03:00:00', '2026-09-22 03:00:00']);
    expect((await run('upcoming')).params.slice(-2)).toEqual(['2026-09-22 03:00:00', '2026-09-27 03:00:00']);
    const overdue = await run('overdue');
    expect(overdue.params.slice(-1)).toEqual(['2026-09-20 03:00:00']);
    expect(overdue.params).toHaveLength(today.params.length - 1);
    const all = await run(undefined);
    expect(all.params).toHaveLength(today.params.length - 2);
  });

  // queue-overdue-filter-matches-metric: due=overdue lists what the overdue metric counts.
  test('the overdue filter leaves out ready cycles unless ready is asked for', async () => {
    const bounds = {
      startOfToday: '2026-09-20 03:00:00',
      startOfTomorrow: '2026-09-21 03:00:00',
      startOfDayAfterTomorrow: '2026-09-22 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-08-21 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    };
    const sqlFor = async (input) => {
      const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
      await new SubscriptionLedgerRepository({ isInitialized: true, query }).listQueue({ ...bounds, ...input });
      const [countSql] = query.mock.calls[0];
      const [listSql] = query.mock.calls[1];
      return { countSql, listSql };
    };
    const clause = "AND q.production_status <> 'ready'";

    const overdue = await sqlFor({ due: 'overdue' });
    expect(overdue.countSql).toContain(clause);
    expect(overdue.listSql).toContain(clause);
    const overdueReady = await sqlFor({ due: 'overdue', productionStatus: 'ready' });
    expect(overdueReady.listSql).not.toContain(clause);
    expect(overdueReady.listSql).toContain('q.production_status = ?');
    expect((await sqlFor({})).listSql).not.toContain(clause);
    expect((await sqlFor({ due: 'today' })).listSql).not.toContain(clause);
  });

  // Unpaid cycles stop at the overdue floor; a paid cycle not ready stays however late it is.
  test('keeps paid overdue cycles below the floor and drops unpaid ones', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-08-21 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("AND (q.due_at >= ? OR q.payment_state = 'paid')");
    expect(params).toEqual(['2026-09-20 03:00:00', '2026-09-27 03:00:00', 1, '2026-09-20 03:00:00', '2026-08-21 03:00:00', '2026-08-21 03:00:00']);
  });

  // keep-ready-orders-dispatchable: a ready Brazil cycle past its day stays until its box leaves, within the floor.
  test('keeps a ready Brazil cycle past its day until a courier delivery is registered', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }, { courierTableName: 'wp_courier_deliveries' }).listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-08-21 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("q.production_status <> 'ready' AND (q.due_at >= ? OR q.payment_state = 'paid')");
    expect(sql).toContain("q.production_status = 'ready' AND q.payment_state = 'paid' AND q.paid_invoice_id IS NOT NULL");
    expect(sql).toContain("q.stripe_account = 'br'");
    expect(sql).toContain("= 'BR'");
    expect(sql).toContain("NOT EXISTS (SELECT 1 FROM `wp_courier_deliveries` cd WHERE");
    expect(sql).toContain("cd.status IN ('out_for_delivery', 'delivered', 'failed')");
    // The second floor is the ready branch's: a ready cycle older than 30 days leaves the queue.
    expect(params.slice(3, 6)).toEqual(['2026-09-20 03:00:00', '2026-08-21 03:00:00', '2026-08-21 03:00:00']);
  });

  test('uses courier_deliveries when no courier table is given', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 0 }]).mockResolvedValueOnce([]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query }).listQueue({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-08-21 03:00:00',
      includeOverdue: true,
      offset: 0,
      perPage: 20
    });
    expect(query.mock.calls[0][0]).toContain('FROM `courier_deliveries` cd');
  });

  test('counts paid cycles not ready past the floor, in the actor markets', async () => {
    const query = jest.fn().mockResolvedValueOnce([{ total: 2 }]);
    const total = await new SubscriptionLedgerRepository({ isInitialized: true, query })
      .countStalePaidQueue({ overdueFloor: '2026-08-21 03:00:00', stripeAccounts: ['br'] });
    const [sql, params] = query.mock.calls[0];
    expect(total).toBe(2);
    expect(sql).toContain("q.payment_state = 'paid' AND q.production_status <> 'ready' AND q.due_at < ?");
    expect(params).toEqual(['2026-08-21 03:00:00', 'br']);
  });

  test('queue metrics omit search and production status filters', async () => {
    const query = jest.fn().mockResolvedValueOnce([
      { current_period_end: '2026-09-20 08:00:00', production_status: 'to_prepare' }
    ]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    await repository.listQueueMetricRows({
      startOfToday: '2026-09-20 03:00:00',
      windowEndExclusive: '2026-09-27 03:00:00',
      overdueFloor: '2026-09-13 03:00:00',
      includeOverdue: true,
      account: 'br'
    });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('q.due_at');
    expect(sql).toContain("s.status IN ('active','trialing','past_due')");
    expect(sql).not.toContain('customer_email LIKE');
    expect(sql).not.toContain('q.production_status = ?');
  });

  test('metrics count in SQL and filter by stripe account', async () => {
    const query = jest.fn().mockResolvedValueOnce([{
      total: 4,
      active: 2,
      canceling: 0,
      pastDue: 1,
      canceled30d: 0,
      renewing7d: 1
    }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const result = await repository.metrics({ stripeAccounts: ['br'] });

    expect(result.total).toBe(4);
    expect(query.mock.calls[0][0]).toContain('COUNT(*) AS total');
    expect(query.mock.calls[0][0]).not.toContain('SELECT *');
    expect(query.mock.calls[0][0]).toContain('`stripe_account` = ?');
    expect(query.mock.calls[0][1]).toEqual(expect.arrayContaining(['br']));
    expect(query.mock.calls[0][0]).toContain("`activated_at` IS NOT NULL AND `canceled_at` >= ?");
    expect(query.mock.calls[0][0]).not.toContain('`updated_at` >= ?');
  });

  function chargedRow(overrides = {}) {
    return {
      id: 1,
      user_id: 7,
      stripe_subscription_id: 'sub_123',
      status: 'active',
      cancel_at_period_end: 0,
      edit_payment_pending: 0,
      charged_deliveries: 2,
      last_charged_invoice_id: 'in_2',
      auto_renew: 0,
      ...overrides
    };
  }

  test('maps the charged count, the last charged invoice, and the renewal preference', async () => {
    const query = jest.fn().mockResolvedValue([chargedRow()]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    const row = await repository.findByStripeSubscriptionId('sub_123');
    expect(row).toMatchObject({ chargedDeliveries: 2, lastChargedInvoiceId: 'in_2', autoRenew: false });

    query.mockResolvedValue([chargedRow({ charged_deliveries: null, last_charged_invoice_id: null, auto_renew: null })]);
    expect(await repository.findByStripeSubscriptionId('sub_123'))
      .toMatchObject({ chargedDeliveries: null, lastChargedInvoiceId: null, autoRenew: null });
  });

  test('seeds the charged count from the recorded earlier invoices only while it is still empty', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([chargedRow()]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    await repository.seedChargedDeliveries('sub_123', ['in_1', 'in_2']);
    expect(query.mock.calls[0][0]).toContain('INSERT IGNORE INTO `subscription_charged_invoices`');
    expect(query.mock.calls[1][1]).toEqual(['sub_123', 'in_2']);
    expect(query.mock.calls[2][0]).toContain('SELECT COUNT(*) FROM `subscription_charged_invoices`');
    expect(query.mock.calls[2][0]).toContain('`charged_deliveries` IS NULL');
  });

  test('adds one charged delivery only when the invoice row is new (3.10)', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce([chargedRow({ charged_deliveries: 3 })]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    const row = await repository.incrementChargedDeliveries('sub_123', 'in_3');
    expect(query.mock.calls[0][1]).toEqual(['sub_123', 'in_3']);
    expect(query.mock.calls[1][0]).toContain('`charged_deliveries` = `charged_deliveries` + 1');
    expect(row.chargedDeliveries).toBe(3);

    const repeat = jest.fn().mockResolvedValueOnce({ affectedRows: 0 }).mockResolvedValueOnce([chargedRow({ charged_deliveries: 3 })]);
    await new SubscriptionLedgerRepository({ isInitialized: true, query: repeat }).incrementChargedDeliveries('sub_123', 'in_1');
    expect(repeat).toHaveBeenCalledTimes(2);
    expect(repeat.mock.calls[1][0]).not.toContain('+ 1');
  });

  test('stores the renewal preference', async () => {
    const query = jest.fn().mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([chargedRow({ auto_renew: 1 })]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    const row = await repository.setAutoRenew('sub_123', true);
    expect(query.mock.calls[0][1]).toEqual([1, 'sub_123']);
    expect(row.autoRenew).toBe(true);
  });

  // admin-today (admin-flow-fixes-5): market exceptions counted by the list's rule, per account.
  test('countMarketExceptions groups the list rule by account, without a limit', async () => {
    const query = jest.fn().mockResolvedValue([{ account: 'us', total: 3 }, { account: 'br', total: 1 }]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });

    const counts = await repository.countMarketExceptions({ stripeAccounts: ['br', 'us'] });

    expect(Object.fromEntries(counts)).toEqual({ us: 3, br: 1 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("s.status NOT IN ('canceled', 'incomplete_expired')");
    expect(sql).toContain('GROUP BY LOWER(s.stripe_account)');
    expect(sql).not.toContain('LIMIT');
    expect(params).toEqual(['br', 'us']);
    await expect(repository.countMarketExceptions({ stripeAccounts: [] })).resolves.toEqual(new Map());
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('SubscriptionLedgerRepository.updateCheckoutReference with an owner', () => {
  const repositoryWith = (query) => new SubscriptionLedgerRepository({ isInitialized: true, query });

  test('patches only the checkout of that subscription, in one statement', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 1 });
    const applied = await repositoryWith(query).updateCheckoutReference(7, {
      payment_state: 'paid',
      stripe_subscription_id: 'sub_b',
      stripe_invoice_id: undefined
    }, { subscriptionId: 'sub_b' });

    expect(applied).toBe(true);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('SET `checkout_reference` = JSON_SET(`checkout_reference`, \'$.payment_state\', CAST(? AS JSON), \'$.stripe_subscription_id\', CAST(? AS JSON))');
    expect(sql).toContain("WHERE `user_id` = ? AND (JSON_UNQUOTE(JSON_EXTRACT(`checkout_reference`, '$.stripe_subscription_id')) = ?)");
    expect(params).toEqual(['"paid"', '"sub_b"', 7, 'sub_b']);
  });

  test('accepts the subscription or the payment intent, leaving an empty id out', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 0 });
    const both = repositoryWith(query);
    await both.updateCheckoutReference(7, { payment_state: 'failed' }, { subscriptionId: 'sub_a', paymentIntentId: 'pi_a' });
    expect(query.mock.calls[0][0]).toContain(
      "(JSON_UNQUOTE(JSON_EXTRACT(`checkout_reference`, '$.stripe_subscription_id')) = ? OR JSON_UNQUOTE(JSON_EXTRACT(`checkout_reference`, '$.stripe_payment_intent_id')) = ?)"
    );
    expect(query.mock.calls[0][1]).toEqual(['"failed"', 7, 'sub_a', 'pi_a']);

    query.mockClear();
    const applied = await both.updateCheckoutReference(7, { payment_state: 'failed' }, { subscriptionId: '', paymentIntentId: 'pi_a' });
    expect(applied).toBe(false);
    expect(query.mock.calls[0][0]).not.toContain('$.stripe_subscription_id');
    expect(query.mock.calls[0][1]).toEqual(['"failed"', 7, 'pi_a']);
  });

  test('an owner with no id writes nothing', async () => {
    const query = jest.fn();
    const applied = await repositoryWith(query).updateCheckoutReference(7, { payment_state: 'paid' }, { subscriptionId: ' ', paymentIntentId: undefined });
    expect(applied).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  test('without an owner the patch keeps merging as before', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ checkout_reference: JSON.stringify({ order_key: 'sub_sub_a', payment_state: 'pending' }) }])
      .mockResolvedValueOnce({ affectedRows: 1 });
    const next = await repositoryWith(query).updateCheckoutReference(7, { payment_state: 'paid' });
    expect(next).toEqual({ order_key: 'sub_sub_a', payment_state: 'paid' });
    expect(query.mock.calls[1][0]).toBe('UPDATE `onboarding_user_state` SET `checkout_reference` = ? WHERE `user_id` = ?');
  });
});
