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
    expect(sql).toContain('s.cancel_at_period_end = 0');
    expect(sql).toContain('ORDER BY s.current_period_end ASC, s.id ASC');
    expect(sql).toContain('LEFT JOIN `subscription_production_cycles`');
    expect(sql).toContain('hsr_market_country');
    expect(sql).not.toContain('LEFT JOIN `wp_users`');
    expect(sql).not.toContain('u.display_name');
    expect(sql).not.toContain('payment_method_last4');
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
    expect(sql).toContain('s.current_period_end');
    expect(sql).toContain("s.status IN ('active','trialing','past_due')");
    expect(sql).not.toContain('customer_email LIKE');
    expect(sql).not.toContain("COALESCE(c.status,'to_prepare') = ?");
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

  test('seeds the charged count only while it is still empty', async () => {
    const query = jest.fn().mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([chargedRow()]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    await repository.seedChargedDeliveries('sub_123', 2, 'in_2');
    expect(query.mock.calls[0][0]).toContain('`charged_deliveries` IS NULL');
    expect(query.mock.calls[0][1]).toEqual([2, 'in_2', 'sub_123']);
  });

  test('adds one charged delivery unless that invoice was the last one counted', async () => {
    const query = jest.fn().mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([chargedRow({ charged_deliveries: 3 })]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    const row = await repository.incrementChargedDeliveries('sub_123', 'in_3');
    expect(query.mock.calls[0][0]).toContain('`charged_deliveries` = `charged_deliveries` + 1');
    expect(query.mock.calls[0][0]).toContain('`last_charged_invoice_id` <> ?');
    expect(query.mock.calls[0][1]).toEqual(['in_3', 'sub_123', 'in_3']);
    expect(row.chargedDeliveries).toBe(3);
  });

  test('stores the renewal preference', async () => {
    const query = jest.fn().mockResolvedValueOnce({ affectedRows: 1 }).mockResolvedValueOnce([chargedRow({ auto_renew: 1 })]);
    const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
    const row = await repository.setAutoRenew('sub_123', true);
    expect(query.mock.calls[0][1]).toEqual([1, 'sub_123']);
    expect(row.autoRenew).toBe(true);
  });
});
