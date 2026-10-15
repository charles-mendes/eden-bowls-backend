const { AddLedgerPendingDeliveryChanges1700000000023 } = require('../src/infrastructure/migrations/1700000000023-add-ledger-pending-delivery-changes');

function queryRunner(existing = []) {
  return {
    hasTable: jest.fn().mockResolvedValue(true),
    hasColumn: jest.fn(async (_table, name) => existing.includes(name)),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined)
  };
}

describe('AddLedgerPendingDeliveryChanges1700000000023', () => {
  test('adds a nullable json column for the following delivery changes', async () => {
    const runner = queryRunner();
    await new AddLedgerPendingDeliveryChanges1700000000023().up(runner);
    expect(runner.addColumn).toHaveBeenCalledWith('stripe_subscriptions', expect.objectContaining({
      name: 'pending_delivery_changes', type: 'json', isNullable: true
    }));
  });

  test('is idempotent and down drops the column', async () => {
    const runner = queryRunner(['pending_delivery_changes']);
    await new AddLedgerPendingDeliveryChanges1700000000023().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    await new AddLedgerPendingDeliveryChanges1700000000023().down(runner);
    expect(runner.dropColumn).toHaveBeenCalledWith('stripe_subscriptions', 'pending_delivery_changes');
  });
});
