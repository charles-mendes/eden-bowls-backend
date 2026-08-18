const { SubscriptionsRepository } = require('../src/infrastructure/repositories/subscriptions.repository');

describe('SubscriptionsRepository', () => {
  test('returns an empty list when the user has no ledger rows', async () => {
    const ledgerRepository = { listByUserId: jest.fn().mockResolvedValue([]) };
    const repository = new SubscriptionsRepository({ ledgerRepository });

    await expect(repository.listMine({ userId: 7 })).resolves.toEqual({
      subscriptions: [],
      count: 0
    });
  });

  test('dedups by stripe_subscription_id and ignores rows without sub_', async () => {
    const ledgerRepository = {
      listByUserId: jest.fn().mockResolvedValue([
        { stripeSubscriptionId: 'sub_123', status: 'active', planLabel: 'Plan #1', userId: 7 },
        { stripeSubscriptionId: 'sub_123', status: 'active', planLabel: 'Plan #1', userId: 7 },
        { stripeSubscriptionId: 'not-a-sub', status: 'active', userId: 7 }
      ])
    };
    const repository = new SubscriptionsRepository({ ledgerRepository });

    const result = await repository.listMine({ userId: 7 });
    expect(result.count).toBe(1);
    expect(result.subscriptions[0].subscription_id).toBe('sub_123');
    expect(result.subscriptions[0].slug).toBe('sub_123');
  });
});
