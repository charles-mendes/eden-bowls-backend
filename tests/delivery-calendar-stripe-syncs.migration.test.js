const { CreateDeliveryCalendarStripeSyncs1700000000028 } = require('../src/infrastructure/migrations/1700000000028-create-delivery-calendar-stripe-syncs');

function queryRunner(hasTable = false) {
  return {
    hasTable: jest.fn().mockResolvedValue(hasTable),
    createTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

describe('CreateDeliveryCalendarStripeSyncs1700000000028', () => {
  test('creates the sync table with the due and subscription indexes', async () => {
    const runner = queryRunner();
    await new CreateDeliveryCalendarStripeSyncs1700000000028().up(runner);
    const [table] = runner.createTable.mock.calls[0];
    const columns = Object.fromEntries(table.columns.map((column) => [column.name, column]));
    expect(table.name).toBe('delivery_calendar_stripe_syncs');
    expect(Object.keys(columns)).toEqual([
      'id', 'stripe_subscription_id', 'market', 'audit_event_id', 'expected_trial_end', 'target_trial_end',
      'found_trial_end', 'status', 'attempts', 'last_error', 'next_attempt_at', 'created_at', 'synced_at'
    ]);
    expect(columns.target_trial_end).toMatchObject({ type: 'datetime', isNullable: false });
    expect(columns.expected_trial_end).toMatchObject({ type: 'datetime', isNullable: true });
    expect(columns.found_trial_end).toMatchObject({ type: 'datetime', isNullable: true });
    expect(columns.status).toMatchObject({ default: "'pending'" });
    expect(runner.createIndex.mock.calls.map(([, index]) => index.columnNames)).toEqual([
      ['status', 'next_attempt_at'],
      ['stripe_subscription_id', 'status']
    ]);
  });

  test('an existing table is left alone; down drops it', async () => {
    const existing = queryRunner(true);
    await new CreateDeliveryCalendarStripeSyncs1700000000028().up(existing);
    expect(existing.createTable).not.toHaveBeenCalled();
    await new CreateDeliveryCalendarStripeSyncs1700000000028().down(existing);
    expect(existing.dropTable).toHaveBeenCalledWith('delivery_calendar_stripe_syncs');
  });
});
