const { CreateFirstPurchaseTermDiscounts1700000000046 } = require('../src/infrastructure/migrations/1700000000046-create-first-purchase-term-discounts');

function queryRunner({ hasTable = false } = {}) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateFirstPurchaseTermDiscounts1700000000046', () => {
  test('Values after deploy: creates the table keyed by account and term and seeds 10/25/40 in both accounts', async () => {
    const runner = queryRunner();

    await new CreateFirstPurchaseTermDiscounts1700000000046().up(runner);

    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('first_purchase_term_discounts');
    expect(table.columns.filter((column) => column.isPrimary).map((column) => column.name)).toEqual(['stripe_account', 'term_months']);
    expect(table.columns.map((column) => column.name)).toEqual(['stripe_account', 'term_months', 'discount_percent', 'updated_by', 'updated_at']);
    expect(runner.query.mock.calls.every(([sql]) => sql.startsWith('INSERT IGNORE INTO `first_purchase_term_discounts`'))).toBe(true);
    expect(runner.query.mock.calls.map(([, params]) => params)).toEqual([
      ['br', 1, 10], ['br', 3, 25], ['br', 6, 40],
      ['us', 1, 10], ['us', 3, 25], ['us', 6, 40]
    ]);
  });

  test('a rerun keeps the table and the stored percents', async () => {
    const runner = queryRunner({ hasTable: true });

    await new CreateFirstPurchaseTermDiscounts1700000000046().up(runner);

    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.query.mock.calls.every(([sql]) => sql.startsWith('INSERT IGNORE'))).toBe(true);
  });

  test('down drops the table', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateFirstPurchaseTermDiscounts1700000000046().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('first_purchase_term_discounts');
  });
});
