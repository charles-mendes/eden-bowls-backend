const { AddSubscriptionLifecycleDates1700000000055 } = require('../src/infrastructure/migrations/1700000000055-add-subscription-lifecycle-dates');
const { buildDataSourceOptions } = require('../src/infrastructure/db');

function queryRunner({ columns = [], indexes = [], tables = ['stripe_subscriptions', 'customer_invoices', 'subscription_charged_invoices'] } = {}) {
  return {
    hasTable: jest.fn(async (name) => tables.includes(name)),
    hasColumn: jest.fn(async (_table, name) => columns.includes(name)),
    addColumn: jest.fn().mockResolvedValue(undefined),
    dropColumn: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(async (sql, params) => {
      if (sql.includes('information_schema.STATISTICS')) {
        return indexes.includes(params[1]) ? [{ 1: 1 }] : [];
      }
      return [];
    })
  };
}

const sqlOf = (runner) => runner.query.mock.calls.map(([sql]) => sql.replace(/\s+/g, ' '));

describe('AddSubscriptionLifecycleDates1700000000055', () => {
  test('adds the activation and cancellation columns with approximate flags', async () => {
    const runner = queryRunner();
    await new AddSubscriptionLifecycleDates1700000000055().up(runner);

    const columns = Object.fromEntries(runner.addColumn.mock.calls.map(([table, column]) => {
      expect(table).toBe('stripe_subscriptions');
      return [column.name, column];
    }));
    expect(columns.activated_at).toMatchObject({ type: 'datetime', isNullable: true });
    expect(columns.canceled_at).toMatchObject({ type: 'datetime', isNullable: true });
    expect(columns.activated_at_approximate).toMatchObject({ type: 'tinyint', isNullable: false });
    expect(columns.canceled_at_approximate).toMatchObject({ type: 'tinyint', isNullable: false });
  });

  test('backfills billable rows, paid canceled rows, then cancellation dates only for activated rows', async () => {
    const runner = queryRunner();
    await new AddSubscriptionLifecycleDates1700000000055().up(runner);
    const updates = sqlOf(runner).filter((sql) => sql.startsWith('UPDATE'));

    expect(updates).toHaveLength(3);
    expect(updates[0]).toContain("status IN ('active', 'trialing', 'past_due', 'paused')");
    expect(updates[0]).toContain('activated_at_approximate = 1');
    expect(updates[1]).toContain("s.status = 'canceled'");
    expect(updates[1]).toContain("ci.invoice_status = 'paid'");
    expect(updates[1]).toContain('subscription_charged_invoices');
    expect(updates[2]).toContain('canceled_at = updated_at');
    expect(updates[2]).toContain('activated_at IS NOT NULL');
  });

  test('a canceled row without invoice tables is left unactivated', async () => {
    const runner = queryRunner({ tables: ['stripe_subscriptions'] });
    await new AddSubscriptionLifecycleDates1700000000055().up(runner);
    const updates = sqlOf(runner).filter((sql) => sql.startsWith('UPDATE'));

    expect(updates).toHaveLength(2);
    expect(updates.some((sql) => sql.includes("s.status = 'canceled'"))).toBe(false);
  });

  test('creates only the missing report indexes', async () => {
    const runner = queryRunner({ indexes: ['idx_customer_invoices_account_issued'] });
    await new AddSubscriptionLifecycleDates1700000000055().up(runner);
    const created = sqlOf(runner).filter((sql) => sql.startsWith('CREATE INDEX'));

    expect(created).toEqual([
      'CREATE INDEX idx_stripe_subscriptions_account_activated ON `stripe_subscriptions` (stripe_account, activated_at)',
      'CREATE INDEX idx_stripe_subscriptions_account_canceled ON `stripe_subscriptions` (stripe_account, canceled_at)'
    ]);
  });

  test('skips a missing ledger table', async () => {
    const runner = queryRunner({ tables: [] });
    await new AddSubscriptionLifecycleDates1700000000055().up(runner);
    expect(runner.addColumn).not.toHaveBeenCalled();
    expect(runner.query).not.toHaveBeenCalled();
  });

  test('down drops the indexes and the four columns', async () => {
    const runner = queryRunner({
      columns: ['activated_at', 'activated_at_approximate', 'canceled_at', 'canceled_at_approximate'],
      indexes: ['idx_customer_invoices_account_issued', 'idx_stripe_subscriptions_account_activated', 'idx_stripe_subscriptions_account_canceled']
    });
    await new AddSubscriptionLifecycleDates1700000000055().down(runner);

    expect(sqlOf(runner).filter((sql) => sql.startsWith('DROP INDEX'))).toHaveLength(3);
    expect(runner.dropColumn.mock.calls.map(([, name]) => name).sort())
      .toEqual(['activated_at', 'activated_at_approximate', 'canceled_at', 'canceled_at_approximate']);
  });

  test('is registered after the pack stock migration', () => {
    const names = buildDataSourceOptions({}).migrations.map((migration) => migration.name);
    expect(names[names.indexOf('AddSubscriptionLifecycleDates1700000000055') - 1]).toBe('CreatePackStock1700000000054');
  });
});
