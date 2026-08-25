const { CreateFeedbacksTable1700000000011 } = require('../src/infrastructure/migrations/1700000000011-create-feedbacks-table');

describe('CreateFeedbacksTable1700000000011', () => {
  test('creates the feedbacks table with country and active indexes', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(false),
      createTable: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined)
    };

    await new CreateFeedbacksTable1700000000011().up(queryRunner);

    const table = queryRunner.createTable.mock.calls[0][0];
    expect(table.name).toBe('feedbacks');
    expect(table.columns.map((column) => column.name)).toEqual([
      'id',
      'name',
      'category',
      'country',
      'photo',
      'comment',
      'active',
      'created_at',
      'updated_at'
    ]);
    expect(queryRunner.createIndex.mock.calls.map(([, index]) => index.name)).toEqual([
      'idx_feedbacks_country',
      'idx_feedbacks_country_active'
    ]);
  });

  test('skips creation when the table already exists', async () => {
    const queryRunner = {
      hasTable: jest.fn().mockResolvedValue(true),
      createTable: jest.fn()
    };

    await new CreateFeedbacksTable1700000000011().up(queryRunner);

    expect(queryRunner.createTable).not.toHaveBeenCalled();
  });
});
