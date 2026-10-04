const { AddLedgerChargedDeliveries1700000000022 } = require('../src/infrastructure/migrations/1700000000022-add-ledger-charged-deliveries');

function queryRunner(existing = []) {
  return {
    hasTable: jest.fn().mockResolvedValue(true),
    hasColumn: jest.fn(async (_table, name) => existing.includes(name)),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined)
  };
}

describe('AddLedgerChargedDeliveries1700000000022', () => {
  test('adds nullable charged deliveries, last charged invoice, and renewal columns to the ledger', async () => {
    const runner = queryRunner();
    await new AddLedgerChargedDeliveries1700000000022().up(runner);

    const columns = Object.fromEntries(runner.addColumn.mock.calls.map(([table, column]) => {
      expect(table).toBe('stripe_subscriptions');
      return [column.name, column];
    }));
    expect(columns.charged_deliveries).toMatchObject({ type: 'int', unsigned: true, isNullable: true });
    expect(columns.last_charged_invoice_id).toMatchObject({ type: 'varchar', length: '64', isNullable: true });
    expect(columns.auto_renew).toMatchObject({ type: 'tinyint', isNullable: true });
  });

  test('skips columns that already exist and a missing ledger table', async () => {
    const runner = queryRunner(['charged_deliveries', 'last_charged_invoice_id', 'auto_renew']);
    await new AddLedgerChargedDeliveries1700000000022().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();

    const missing = queryRunner();
    missing.hasTable.mockResolvedValue(false);
    await new AddLedgerChargedDeliveries1700000000022().up(missing);
    expect(missing.addColumn).not.toHaveBeenCalled();
  });

  test('down drops the three columns', async () => {
    const runner = queryRunner(['charged_deliveries', 'last_charged_invoice_id', 'auto_renew']);
    await new AddLedgerChargedDeliveries1700000000022().down(runner);
    expect(runner.dropColumn.mock.calls.map(([, name]) => name).sort())
      .toEqual(['auto_renew', 'charged_deliveries', 'last_charged_invoice_id']);
  });
});
