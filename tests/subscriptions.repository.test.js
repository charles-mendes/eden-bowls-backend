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

  describe('plan_notice', () => {
    const inside = (id) => ({
      stripeSubscriptionId: id,
      stripeAccount: 'br',
      status: 'active',
      autoRenew: true,
      subscriptionTermMonths: 1,
      chargedDeliveries: 1,
      currentPeriodEnd: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      userId: 7
    });

    test('Email switched off: the banner still shows, and the window is read once per market', async () => {
      const settingsRepository = { forMarket: jest.fn().mockResolvedValue({ renewalNoticeEnabled: false, planEndingNoticeEnabled: false, planNoticeDays: 7 }) };
      const ledgerRepository = { listByUserId: jest.fn().mockResolvedValue([inside('sub_1'), inside('sub_2')]) };
      const repository = new SubscriptionsRepository({ ledgerRepository, settingsRepository });

      const { subscriptions } = await repository.listMine({ userId: 7 });

      expect(subscriptions[0].plan_notice).toMatchObject({ kind: 'renewal', days_left: 2 });
      expect(settingsRepository.forMarket).toHaveBeenCalledTimes(1);
      expect(settingsRepository.forMarket).toHaveBeenCalledWith('BR');
    });

    test('Outside the window', async () => {
      const settingsRepository = { forMarket: jest.fn().mockResolvedValue({ planNoticeDays: 1 }) };
      const ledgerRepository = { listByUserId: jest.fn().mockResolvedValue([inside('sub_1')]) };
      const { subscriptions } = await new SubscriptionsRepository({ ledgerRepository, settingsRepository }).listMine({ userId: 7 });
      expect(subscriptions[0].plan_notice).toBeNull();
    });

    test('a settings failure costs the banner, not the list', async () => {
      const settingsRepository = { forMarket: jest.fn().mockRejectedValue(new Error('db down')) };
      const ledgerRepository = { listByUserId: jest.fn().mockResolvedValue([inside('sub_1')]) };
      const { subscriptions } = await new SubscriptionsRepository({ ledgerRepository, settingsRepository }).listMine({ userId: 7 });
      expect(subscriptions[0].plan_notice).toBeNull();
    });
  });
});
