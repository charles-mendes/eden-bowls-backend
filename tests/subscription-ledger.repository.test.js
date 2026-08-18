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
});
