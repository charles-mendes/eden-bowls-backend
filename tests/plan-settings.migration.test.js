const { CreatePlanSettings1700000000073 } = require('../src/infrastructure/migrations/1700000000073-create-plan-settings');

function queryRunner({ hasTable = () => false, products = {} } = {}) {
  return {
    hasTable: jest.fn(async (name) => hasTable(name)),
    createTable: jest.fn(),
    dropTable: jest.fn(),
    query: jest.fn(async (sql, params) => {
      if (sql.includes('FROM `wp_posts`')) {
        const product = products[params[0]];
        return product ? [product] : [];
      }
      return [];
    })
  };
}

const catalogTables = (name) => name === 'wp_posts' || name === 'wp_postmeta';

function inserts(runner) {
  return runner.query.mock.calls.filter(([sql]) => sql.includes('INSERT IGNORE')).map(([, params]) => params);
}

describe('CreatePlanSettings1700000000073', () => {
  test('creates the table with one row per market', async () => {
    const runner = queryRunner();

    await new CreatePlanSettings1700000000073().up(runner);

    const [table] = runner.createTable.mock.calls[0];
    expect(table.name).toBe('plan_settings');
    expect(table.columns.map((column) => column.name)).toEqual([
      'market', 'plan_days', 'large_pack_limit', 'updated_by', 'created_at', 'updated_at'
    ]);
    expect(table.columns.find((column) => column.name === 'market').isPrimary).toBe(true);
  });

  test('copies the values of the first published product of each market', async () => {
    const runner = queryRunner({
      hasTable: catalogTables,
      products: { BR: { days: '30', large_pack_limit: '6' }, US: { days: '28', large_pack_limit: null } }
    });

    await new CreatePlanSettings1700000000073().up(runner);

    const lookup = runner.query.mock.calls.find(([sql]) => sql.includes('FROM `wp_posts`'))[0];
    expect(lookup).toContain("p.post_status = 'publish'");
    expect(lookup).toContain('ORDER BY p.menu_order ASC, p.ID ASC');
    expect(lookup).toContain('LIMIT 1');
    expect(inserts(runner)).toEqual([['BR', 30, 6], ['US', 28, 8]]);
  });

  test('falls back to 30 days and limit 8 as the recommendation did', async () => {
    const runner = queryRunner({
      hasTable: catalogTables,
      products: { BR: { days: '28.5', large_pack_limit: '61' } }
    });

    await new CreatePlanSettings1700000000073().up(runner);

    expect(inserts(runner)).toEqual([['BR', 30, 8], ['US', 30, 8]]);
  });

  test('keeps a row already present and seeds without a catalog', async () => {
    const runner = queryRunner({ hasTable: (name) => name === 'plan_settings' });

    await new CreatePlanSettings1700000000073().up(runner);

    expect(runner.createTable).not.toHaveBeenCalled();
    expect(runner.query.mock.calls.every(([sql]) => sql.startsWith('INSERT IGNORE'))).toBe(true);
    expect(inserts(runner)).toEqual([['BR', 30, 8], ['US', 30, 8]]);
  });

  test('down removes the table', async () => {
    const runner = queryRunner({ hasTable: () => true });
    await new CreatePlanSettings1700000000073().down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('plan_settings');
  });
});
