const { CreatePetLifeStageTracking1700000000037 } = require('../src/infrastructure/migrations/1700000000037-create-pet-life-stage-tracking');

function queryRunner({ existing = [] } = {}) {
  return {
    hasTable: jest.fn(async (name) => existing.includes(name)),
    createTable: jest.fn().mockResolvedValue(undefined),
    createIndex: jest.fn().mockResolvedValue(undefined),
    createForeignKey: jest.fn().mockResolvedValue(undefined),
    dropTable: jest.fn().mockResolvedValue(undefined)
  };
}

function columnsOf(runner, tableName) {
  const [table] = runner.createTable.mock.calls.find(([candidate]) => candidate.name === tableName);
  return table.columns.map((column) => column.name);
}

describe('CreatePetLifeStageTracking1700000000037', () => {
  test('creates the history, notice and announcement tables with their keys', async () => {
    const runner = queryRunner({ existing: ['stripe_subscriptions'] });
    await new CreatePetLifeStageTracking1700000000037().up(runner);

    expect(columnsOf(runner, 'pet_age_changes')).toEqual([
      'id', 'pet_id', 'user_id', 'old_age_years', 'old_age_months', 'old_birth_date',
      'new_age_years', 'new_age_months', 'new_birth_date', 'old_life_stage', 'new_life_stage', 'source', 'changed_at'
    ]);
    expect(columnsOf(runner, 'pet_life_stage_notices')).toEqual([
      'id', 'subscription_id', 'pet_id', 'from_line', 'to_line', 'detected_at',
      'dismissed_at', 'resolved_at', 'notified_at', 'notified_via', 'created_at', 'updated_at'
    ]);
    expect(columnsOf(runner, 'life_stage_announcements')).toEqual(['market', 'started_at', 'sent_at', 'created_at', 'updated_at']);

    const unique = runner.createIndex.mock.calls.filter(([, index]) => index.isUnique);
    expect(unique.map(([table, index]) => [table, index.columnNames])).toEqual([
      ['pet_life_stage_notices', ['subscription_id', 'pet_id', 'from_line', 'to_line']]
    ]);
    const [table, foreignKey] = runner.createForeignKey.mock.calls[0];
    expect(table).toBe('pet_life_stage_notices');
    expect(foreignKey).toMatchObject({ referencedTableName: 'stripe_subscriptions', onDelete: 'CASCADE' });
  });

  test('a second run creates nothing', async () => {
    const runner = queryRunner({ existing: ['pet_age_changes', 'pet_life_stage_notices', 'life_stage_announcements'] });
    await new CreatePetLifeStageTracking1700000000037().up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
  });

  test('down drops the three tables', async () => {
    const runner = queryRunner({ existing: ['pet_age_changes', 'pet_life_stage_notices', 'life_stage_announcements'] });
    await new CreatePetLifeStageTracking1700000000037().down(runner);
    expect(runner.dropTable.mock.calls.map(([name]) => name)).toEqual(['life_stage_announcements', 'pet_life_stage_notices', 'pet_age_changes']);
  });
});
