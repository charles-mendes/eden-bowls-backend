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
    expect(query).toHaveBeenCalledWith(expect.stringContaining('WHERE `user_id` = ?'), [7]);
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
        display_name: 'Ana Costa'
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
    expect(sql).toContain('LEFT JOIN `wp_users`');
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
});
