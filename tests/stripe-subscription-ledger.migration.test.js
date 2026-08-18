const { CreateStripeSubscriptionLedgerTables1700000000009 } = require('../src/infrastructure/migrations/1700000000009-create-stripe-subscription-ledger-tables');

describe('CreateStripeSubscriptionLedgerTables1700000000009', () => {
  test('creates ledger and webhook event tables', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined)
    };

    await new CreateStripeSubscriptionLedgerTables1700000000009().up(queryRunner);

    const createdTables = queryRunner.createTable.mock.calls.map(([table]) => table);
    expect(createdTables.map((table) => table.name)).toEqual([
      'stripe_subscriptions',
      'stripe_webhook_events'
    ]);
    expect(createdTables[0].columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'user_id',
      'stripe_subscription_id',
      'status',
      'edit_payment_pending'
    ]));
    expect(createdTables[1].columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'event_id',
      'type',
      'processed_at'
    ]));
  });
});
