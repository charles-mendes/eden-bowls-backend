const { CreateSubscriptionChargedInvoices1700000000024 } = require('../src/infrastructure/migrations/1700000000024-create-subscription-charged-invoices');

function queryRunner({ hasInvoices = false, hasLedger = true } = {}) {
  return {
    hasTable: jest.fn(async (name) => (name === 'subscription_charged_invoices' ? hasInvoices : hasLedger)),
    hasColumn: jest.fn().mockResolvedValue(true),
    createTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ affectedRows: 0 })
  };
}

describe('CreateSubscriptionChargedInvoices1700000000024 (3.10)', () => {
  test('creates the table unique on subscription and invoice, then copies each last counted invoice', async () => {
    const runner = queryRunner();
    await new CreateSubscriptionChargedInvoices1700000000024().up(runner);

    const table = runner.createTable.mock.calls[0][0];
    expect(table.name).toBe('subscription_charged_invoices');
    expect(table.columns.map((column) => column.name)).toEqual(['id', 'stripe_subscription_id', 'invoice_id', 'created_at']);
    const index = runner.createIndex.mock.calls[0][1];
    expect(index).toMatchObject({ isUnique: true, columnNames: ['stripe_subscription_id', 'invoice_id'] });
    const sql = runner.query.mock.calls[0][0];
    expect(sql).toContain('INSERT IGNORE INTO `subscription_charged_invoices`');
    expect(sql).toContain('SELECT `stripe_subscription_id`, `last_charged_invoice_id` FROM `stripe_subscriptions`');
  });

  test('a second run keeps the table and repeats the copy safely', async () => {
    const runner = queryRunner({ hasInvoices: true });
    await new CreateSubscriptionChargedInvoices1700000000024().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.query.mock.calls[0][0]).toContain('INSERT IGNORE');
  });

  test('down drops the table', async () => {
    const runner = queryRunner({ hasInvoices: true });
    await new CreateSubscriptionChargedInvoices1700000000024().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('subscription_charged_invoices');
  });
});
