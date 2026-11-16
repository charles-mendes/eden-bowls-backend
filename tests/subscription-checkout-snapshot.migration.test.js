const { AddSubscriptionCheckoutSnapshot1700000000071 } = require('../src/infrastructure/migrations/1700000000071-add-subscription-checkout-snapshot');

const plan = { pets: [{ pet_id: '7' }], catalog_pricing: { line_items: [{ sku: 'A' }] } };

function row(overrides = {}) {
  return {
    id: 5,
    ledger_plan: JSON.stringify(plan),
    ledger_address: JSON.stringify({ city: 'Rio' }),
    ledger_shipping: JSON.stringify({ cost: 10 }),
    pets_snapshot: JSON.stringify({ pet_ids: ['7'] }),
    subscription_term_months: 6,
    checkout_reference: JSON.stringify({ stripe_subscription_id: 'sub_5', stripe_client_secret: 'pi_secret', total: 99 }),
    plan_selection: JSON.stringify(plan),
    address: JSON.stringify({ city: 'Rio' }),
    shipping: JSON.stringify({ cost: 10 }),
    recurrence: JSON.stringify({ frequency: 'monthly' }),
    ...overrides
  };
}

function runner({ hasColumn = false, rows = [] } = {}) {
  return {
    hasTable: jest.fn(async () => true),
    hasColumn: jest.fn(async () => hasColumn),
    query: jest.fn(async (sql) => (sql.startsWith('SELECT') ? rows : undefined))
  };
}

const updates = (queryRunner) => queryRunner.query.mock.calls.filter(([sql]) => sql.startsWith('UPDATE'));

describe('AddSubscriptionCheckoutSnapshot1700000000071', () => {
  test('adds the nullable JSON column', async () => {
    const queryRunner = runner();
    await new AddSubscriptionCheckoutSnapshot1700000000071().up(queryRunner);
    expect(queryRunner.query.mock.calls[0][0]).toBe('ALTER TABLE `stripe_subscriptions` ADD COLUMN `checkout_snapshot` JSON NULL');
  });

  test('backfills only the subscription the onboarding row belongs to', async () => {
    const queryRunner = runner({ hasColumn: true, rows: [row()] });
    await new AddSubscriptionCheckoutSnapshot1700000000071().up(queryRunner);
    const select = queryRunner.query.mock.calls.find(([sql]) => sql.startsWith('SELECT'))[0];
    const [[sql, [snapshot, id]]] = updates(queryRunner);

    expect(select).toContain("JSON_UNQUOTE(JSON_EXTRACT(u.`checkout_reference`, '$.stripe_subscription_id')) = s.`stripe_subscription_id`");
    expect(select).toContain('s.`checkout_snapshot` IS NULL');
    expect(sql).toContain('AND `checkout_snapshot` IS NULL');
    expect(id).toBe(5);
    expect(JSON.parse(snapshot)).toEqual({
      version: 1,
      source: 'backfill',
      captured_at: null,
      checkout_reference: { stripe_subscription_id: 'sub_5', total: 99 },
      plan_selection: plan,
      pets_snapshot: { pet_ids: ['7'] },
      address: { city: 'Rio' },
      shipping: { cost: 10 },
      recurrence: { frequency: 'monthly' },
      subscription_term_months: 6
    });
  });

  test.each([
    ['a new draft plan', { plan_selection: JSON.stringify({ pets: [{ pet_id: '8' }] }) }],
    ['an edited subscription', { ledger_plan: JSON.stringify({ edited: true }) }],
    ['a changed address', { address: JSON.stringify({ city: 'Niterói' }) }],
    ['a changed shipping', { shipping: JSON.stringify({ cost: 20 }) }]
  ])('leaves the purchase partial after %s', async (_name, overrides) => {
    const queryRunner = runner({ hasColumn: true, rows: [row(overrides)] });
    await new AddSubscriptionCheckoutSnapshot1700000000071().up(queryRunner);
    expect(updates(queryRunner)).toHaveLength(0);
  });

  test('drops the column on down', async () => {
    const queryRunner = runner({ hasColumn: true });
    await new AddSubscriptionCheckoutSnapshot1700000000071().down(queryRunner);
    expect(queryRunner.query).toHaveBeenCalledWith('ALTER TABLE `stripe_subscriptions` DROP COLUMN `checkout_snapshot`');
  });
});
