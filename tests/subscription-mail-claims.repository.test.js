const { SubscriptionMailClaimsRepository } = require('../src/infrastructure/repositories/subscription-mail-claims.repository');

describe('SubscriptionMailClaimsRepository', () => {
  test('INSERT duplicate unique key returns claimed: false', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn()
        .mockResolvedValueOnce({ insertId: 11 })
        .mockRejectedValueOnce({ code: 'ER_DUP_ENTRY', errno: 1062 })
    };
    const repository = new SubscriptionMailClaimsRepository(dataSource);

    await expect(repository.claimMailSend({
      subscriptionId: 'sub_123',
      template: 'order_confirmed',
      referenceId: 'in_1'
    })).resolves.toEqual({ claimed: true, id: 11 });

    await expect(repository.claimMailSend({
      subscriptionId: 'sub_123',
      template: 'order_confirmed',
      referenceId: 'in_1'
    })).resolves.toEqual({ claimed: false });
  });

  test('markSent updates sent_at only for claimed rows', async () => {
    const dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue({ affectedRows: 1 })
    };
    const repository = new SubscriptionMailClaimsRepository(dataSource);

    await repository.markSent(11);

    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('SET `sent_at` = CURRENT_TIMESTAMP'),
      [11]
    );
  });
});
