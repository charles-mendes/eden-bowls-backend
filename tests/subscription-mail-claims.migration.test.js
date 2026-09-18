const { CreateSubscriptionMailClaims1700000000017 } = require('../src/infrastructure/migrations/1700000000017-create-subscription-mail-claims');

describe('CreateSubscriptionMailClaims1700000000017', () => {
  test('creates unique claim on subscription, template and reference', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined)
    };

    await new CreateSubscriptionMailClaims1700000000017().up(queryRunner);

    const table = queryRunner.createTable.mock.calls[0][0];
    expect(table.name).toBe('subscription_mail_claims');
    expect(table.columns.map((column) => column.name)).toEqual([
      'id',
      'stripe_subscription_id',
      'template',
      'reference_id',
      'claimed_at',
      'sent_at'
    ]);
    expect(queryRunner.createIndex.mock.calls[0][1]).toMatchObject({
      name: 'uniq_subscription_mail_claim',
      isUnique: true,
      columnNames: ['stripe_subscription_id', 'template', 'reference_id']
    });
  });

  test('skips creation when the table already exists', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      createTable: jest.fn()
    };

    await new CreateSubscriptionMailClaims1700000000017().up(queryRunner);

    expect(queryRunner.createTable).not.toHaveBeenCalled();
  });
});
