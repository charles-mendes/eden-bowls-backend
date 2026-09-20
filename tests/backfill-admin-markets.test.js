const { collectBackfillStats, parseArgs, runBackfill } = require('../src/scripts/backfill-admin-markets');

describe('backfill-admin-markets', () => {
  test('parses --dry-run', () => {
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseArgs([])).toEqual({ dryRun: false });
  });

  test('dry-run prints counts without writes', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 3 }])
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([{ total: 4 }])
      .mockResolvedValueOnce([{ total: 1 }]);
    const log = { log: jest.fn() };

    const stats = await runBackfill({ query, dryRun: true, log });

    expect(stats).toEqual({
      fillableProfiles: 3,
      fillableOnboarding: 2,
      orphansWithoutCountry: 4,
      profileVsStripeConflicts: 1
    });
    expect(query).toHaveBeenCalledTimes(4);
    expect(log.log).toHaveBeenCalledWith(expect.stringContaining('"dryRun":true'));
    expect(query.mock.calls.every((call) => String(call[0]).startsWith('SELECT'))).toBe(true);
  });

  test('apply mode upserts empty profile and onboarding markets', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 })
      .mockResolvedValueOnce({ affectedRows: 1 });

    await runBackfill({ query, dryRun: false, log: { log() {} } });

    expect(query.mock.calls[4][0]).toContain('UPDATE `wp_usermeta`');
    expect(query.mock.calls[5][0]).toContain('INSERT INTO `wp_usermeta`');
    expect(query.mock.calls[6][0]).toContain('UPDATE `onboarding_user_state`');
  });

  test('collects fillable, orphan, and conflict counts', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 8 }])
      .mockResolvedValueOnce([{ total: 5 }])
      .mockResolvedValueOnce([{ total: 2 }])
      .mockResolvedValueOnce([{ total: 3 }]);

    await expect(collectBackfillStats(query)).resolves.toEqual({
      fillableProfiles: 8,
      fillableOnboarding: 5,
      orphansWithoutCountry: 2,
      profileVsStripeConflicts: 3
    });
  });
});
