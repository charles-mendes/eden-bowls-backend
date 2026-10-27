const { FirstPurchaseTermDiscountsRepository } = require('../src/infrastructure/repositories/first-purchase-term-discounts.repository');

// Rows per account, as the table holds them.
function dataSourceWith(rows) {
  const state = { rows: rows.map((row) => ({ ...row })) };
  const query = jest.fn(async (sql, params) => {
    if (sql.startsWith('SELECT')) {
      return state.rows.filter((row) => row.stripe_account === params[0]);
    }
    const [account, term, percent] = params;
    state.rows = state.rows.filter((row) => !(row.stripe_account === account && row.term_months === term));
    state.rows.push({ stripe_account: account, term_months: term, discount_percent: percent });
    return undefined;
  });
  return { isInitialized: true, query };
}

const SEEDED = ['br', 'us'].flatMap((stripe_account) => [[1, 10], [3, 25], [6, 40]]
  .map(([term_months, discount_percent]) => ({ stripe_account, term_months, discount_percent })));

describe('FirstPurchaseTermDiscountsRepository', () => {
  test('Values after deploy: reads the seeded percents of an account', async () => {
    const repository = new FirstPurchaseTermDiscountsRepository(dataSourceWith(SEEDED));
    await expect(repository.percentsFor('BR')).resolves.toEqual({ 1: 10, 3: 25, 6: 40 });
  });

  test('accounts are independent', async () => {
    const dataSource = dataSourceWith(SEEDED);
    const repository = new FirstPurchaseTermDiscountsRepository(dataSource);

    await repository.savePercent({ account: 'us', termMonths: 6, percent: 35, actorId: 7 });

    await expect(repository.percentsFor('us')).resolves.toEqual({ 1: 10, 3: 25, 6: 35 });
    await expect(repository.percentsFor('br')).resolves.toEqual({ 1: 10, 3: 25, 6: 40 });
    expect(dataSource.query.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE discount_percent = VALUES(discount_percent)');
    expect(dataSource.query.mock.calls[0][1]).toEqual(['us', 6, 35, 7]);
  });

  test('caches each account for 60 seconds and clears the cache on save', async () => {
    const dataSource = dataSourceWith(SEEDED);
    const repository = new FirstPurchaseTermDiscountsRepository(dataSource);

    await repository.percentsFor('br');
    await repository.percentsFor('br');
    expect(dataSource.query).toHaveBeenCalledTimes(1);

    await repository.savePercent({ account: 'br', termMonths: 3, percent: 30 });
    await expect(repository.percentsFor('br')).resolves.toMatchObject({ 3: 30 });
    expect(repository.ttlMs).toBe(60 * 1000);
  });

  test('a caller cannot change the cached percents', async () => {
    const repository = new FirstPurchaseTermDiscountsRepository(dataSourceWith(SEEDED));
    const first = await repository.percentsFor('br');
    first[1] = 99;
    await expect(repository.percentsFor('br')).resolves.toMatchObject({ 1: 10 });
  });

  test('writes through a transaction manager when given', async () => {
    const dataSource = dataSourceWith(SEEDED);
    const manager = { query: jest.fn().mockResolvedValue(undefined) };
    const repository = new FirstPurchaseTermDiscountsRepository(dataSource);

    await repository.savePercent({ account: 'br', termMonths: 1, percent: 15 }, manager);

    expect(manager.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'), ['br', 1, 15, null]);
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  test('uses the percents of before the table while it does not exist', async () => {
    const dataSource = { isInitialized: true, query: jest.fn().mockRejectedValue(new Error("ER_NO_SUCH_TABLE: Table 'first_purchase_term_discounts' doesn't exist")) };
    await expect(new FirstPurchaseTermDiscountsRepository(dataSource).percentsFor('us')).resolves.toEqual({ 1: 10, 3: 25, 6: 40 });
  });

  test('refuses an unknown account', async () => {
    await expect(new FirstPurchaseTermDiscountsRepository(dataSourceWith(SEEDED)).percentsFor('mx')).rejects.toMatchObject({ statusCode: 400 });
  });
});
