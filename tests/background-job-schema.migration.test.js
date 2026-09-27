const fs = require('fs');
const path = require('path');
const { AddBackgroundJobSchema1700000000020 } = require('../src/infrastructure/migrations/1700000000020-add-background-job-schema');

const WEBHOOK_COLUMNS = ['attempts', 'last_error', 'next_attempt_at', 'failed_at', 'created_at'];
const MAIL_COLUMNS = ['attempts', 'last_error', 'exhausted_at', 'payload'];

function createRunner(state) {
  return {
    hasTable: jest.fn(async (name) => {
      if (name === 'background_job_cursors') {
        return state.cursor;
      }
      return true;
    }),
    hasColumn: jest.fn(async (table, name) => state.columns.has(`${table}.${name}`)),
    getTable: jest.fn(async () => ({
      columns: [{ name: 'processed_at', isNullable: state.processedNullable }],
      uniques: [{ name: 'uniq_subscription_mail_claim', columnNames: ['stripe_subscription_id', 'template', 'reference_id'] }]
    })),
    changeColumn: jest.fn(async () => {
      state.processedNullable = true;
    }),
    addColumn: jest.fn(async (table, column) => {
      state.columns.add(`${table}.${column.name}`);
    }),
    createTable: jest.fn(async () => {
      state.cursor = true;
    }),
    dropColumn: jest.fn(),
    dropTable: jest.fn(),
    dropUnique: jest.fn(),
    createUnique: jest.fn(),
    query: jest.fn()
  };
}

describe('AddBackgroundJobSchema1700000000020', () => {
  test('makes processed_at nullable without clearing existing values and adds retry columns', async () => {
    const state = {
      columns: new Set(['stripe_webhook_events.processed_at']),
      processedNullable: false,
      cursor: false
    };
    const queryRunner = createRunner(state);
    const migration = new AddBackgroundJobSchema1700000000020();

    await migration.up(queryRunner);

    expect(queryRunner.changeColumn).toHaveBeenCalledWith(
      'stripe_webhook_events',
      'processed_at',
      expect.objectContaining({ name: 'processed_at', isNullable: true })
    );
    expect(queryRunner.query).not.toHaveBeenCalled();
    for (const name of WEBHOOK_COLUMNS) {
      expect(queryRunner.addColumn).toHaveBeenCalledWith(
        'stripe_webhook_events',
        expect.objectContaining({ name })
      );
    }
    expect(queryRunner.dropTable).not.toHaveBeenCalled();
  });

  test('adds mail retry columns and leaves the unique claim key untouched', async () => {
    const state = {
      columns: new Set(['stripe_webhook_events.processed_at', ...WEBHOOK_COLUMNS.map((name) => `stripe_webhook_events.${name}`)]),
      processedNullable: true,
      cursor: true
    };
    const queryRunner = createRunner(state);
    await new AddBackgroundJobSchema1700000000020().up(queryRunner);

    for (const name of MAIL_COLUMNS) {
      expect(queryRunner.addColumn).toHaveBeenCalledWith(
        'subscription_mail_claims',
        expect.objectContaining({ name })
      );
    }
    expect(queryRunner.dropUnique).not.toHaveBeenCalled();
    expect(queryRunner.createUnique).not.toHaveBeenCalled();

    const createMigration = fs.readFileSync(
      path.join(__dirname, '../src/infrastructure/migrations/1700000000017-create-subscription-mail-claims.js'),
      'utf8'
    );
    expect(createMigration).toContain('uniq_subscription_mail_claim');
    expect(createMigration).toContain('stripe_subscription_id');
    expect(createMigration).toContain('template');
    expect(createMigration).toContain('reference_id');
  });

  test('creates background_job_cursors and a second up is a no-op', async () => {
    const state = {
      columns: new Set([
        'stripe_webhook_events.processed_at',
        ...WEBHOOK_COLUMNS.map((name) => `stripe_webhook_events.${name}`),
        ...MAIL_COLUMNS.map((name) => `subscription_mail_claims.${name}`)
      ]),
      processedNullable: false,
      cursor: false
    };
    const queryRunner = createRunner(state);
    const migration = new AddBackgroundJobSchema1700000000020();

    await migration.up(queryRunner);
    expect(queryRunner.createTable).toHaveBeenCalledWith(expect.objectContaining({
      name: 'background_job_cursors'
    }));
    const table = queryRunner.createTable.mock.calls[0][0];
    expect(table.columns.map((column) => column.name)).toEqual(['job_name', 'cursor', 'updated_at']);

    queryRunner.changeColumn.mockClear();
    queryRunner.addColumn.mockClear();
    queryRunner.createTable.mockClear();
    state.processedNullable = true;

    await migration.up(queryRunner);
    expect(queryRunner.changeColumn).not.toHaveBeenCalled();
    expect(queryRunner.addColumn).not.toHaveBeenCalled();
    expect(queryRunner.createTable).not.toHaveBeenCalled();
  });
});
