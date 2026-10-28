const { CreateAutomatedEmailSettings1700000000053 } = require('../src/infrastructure/migrations/1700000000053-create-automated-email-settings');

function queryRunner({ hasTable = false } = {}) {
  return { hasTable: jest.fn().mockResolvedValue(hasTable), createTable: jest.fn(), dropTable: jest.fn(), query: jest.fn() };
}

const seeded = (runner) => Object.fromEntries(runner.query.mock.calls
  .filter(([sql]) => sql.includes('INSERT IGNORE'))
  .map(([, [market, enabled, batch, cap]]) => [market, { enabled, batch, cap }]));

describe('CreateAutomatedEmailSettings1700000000053', () => {
  test('Values after deploy', async () => {
    const runner = queryRunner();

    await new CreateAutomatedEmailSettings1700000000053({ LIFE_STAGE_CHANGE_EMAIL_ENABLED_US: 'false' }).up(runner);

    expect(runner.createTable.mock.calls[0][0].name).toBe('automated_email_settings');
    expect(seeded(runner)).toEqual({
      BR: { enabled: 1, batch: 50, cap: 300 },
      US: { enabled: 0, batch: 50, cap: 300 }
    });
  });

  test('stores the batch and cap the environment held, never a cap below the batch', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateAutomatedEmailSettings1700000000053({ LIFE_STAGE_ANNOUNCEMENT_BATCH_SIZE: '120', LIFE_STAGE_ANNOUNCEMENT_DAILY_CAP: '80' }).up(runner);
    expect(runner.createTable).not.toHaveBeenCalled();
    expect(seeded(runner).BR).toEqual({ enabled: 1, batch: 120, cap: 120 });

    const invalid = queryRunner({ hasTable: true });
    await new CreateAutomatedEmailSettings1700000000053({ LIFE_STAGE_ANNOUNCEMENT_BATCH_SIZE: '0', LIFE_STAGE_ANNOUNCEMENT_DAILY_CAP: 'many' }).up(invalid);
    expect(seeded(invalid).US).toEqual({ enabled: 1, batch: 50, cap: 300 });
  });

  test('down removes the table', async () => {
    const runner = queryRunner({ hasTable: true });
    await new CreateAutomatedEmailSettings1700000000053({}).down(runner);
    expect(runner.dropTable).toHaveBeenCalledWith('automated_email_settings');
  });
});
