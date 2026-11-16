const { SubscriptionLedgerRepository } = require('../src/infrastructure/repositories/subscription-ledger.repository');

test('listPlanNoticeCandidates is bounded by account, status, and window, nearest first, with no row limit', async () => {
  const query = jest.fn().mockResolvedValue([{ id: 1, stripe_subscription_id: 'sub_1', status: 'active' }]);
  const repository = new SubscriptionLedgerRepository({ isInitialized: true, query });
  const from = new Date('2026-11-02T12:00:00.000Z');
  const until = new Date('2026-11-09T12:00:00.000Z');

  const rows = await repository.listPlanNoticeCandidates('BR', from, until);

  const [sql, params] = query.mock.calls[0];
  expect(sql).toContain("`status` IN ('active', 'trialing')");
  expect(sql).toContain('`current_period_end` BETWEEN ? AND ?');
  expect(sql).toContain('ORDER BY `current_period_end`, `id`');
  expect(sql).not.toContain('LIMIT');
  expect(params).toEqual(['br', from, until]);
  expect(rows[0].stripeSubscriptionId).toBe('sub_1');
});
