const { AuthRefreshTokenRepository } = require('../src/infrastructure/repositories/auth-refresh-token.repository');
const { runTick } = require('../src/core/job-scheduler');
const {
  JOB_INTERVALS,
  LOCKS,
  createJobDefinitions,
  runRefreshCleanup,
  runWebhookRetention
} = require('../src/services/background-jobs.service');

function lockedRunner() {
  const query = jest.fn()
    .mockResolvedValueOnce([{ locked: 1 }])
    .mockResolvedValueOnce([]);
  return {
    dataSource: {
      createQueryRunner: () => ({
        connect: jest.fn().mockResolvedValue(undefined),
        query,
        release: jest.fn().mockResolvedValue(undefined)
      })
    },
    query
  };
}

describe('daily maintenance jobs', () => {
  test('deletes expired refresh tokens and leaves unexpired rows out of the delete', async () => {
    const query = jest.fn().mockResolvedValue({ affectedRows: 2 });
    const repository = new AuthRefreshTokenRepository({ isInitialized: true, query });
    const now = new Date('2026-01-01T00:00:00Z');

    await expect(repository.deleteExpired(now)).resolves.toBe(2);
    await expect(runRefreshCleanup({ refreshTokenRepository: repository }, now)).resolves.toEqual({ deleted: 2 });

    const sql = query.mock.calls[0][0];
    expect(sql).toContain('DELETE');
    expect(sql).toContain('`expires_at` < ?');
    expect(sql).not.toContain('`expires_at` <=');
    expect(JOB_INTERVALS.refresh_cleanup).toBe(24 * 60 * 60 * 1000);
  });

  test('refresh cleanup takes its own lock', async () => {
    const deleteExpired = jest.fn().mockResolvedValue(1);
    const jobs = createJobDefinitions({
      refreshTokenRepository: { deleteExpired },
      eventsRepository: { deleteProcessedBefore: jest.fn() },
      stripeWebhookService: { retryPending: jest.fn() },
      transactionalMailer: { resendUnsent: jest.fn() },
      ledgerRepository: {},
      cursorRepository: { get: jest.fn(), set: jest.fn() },
      upsShipmentRepository: {},
      upsClient: {}
    });
    const job = jobs.find((item) => item.name === 'refresh_cleanup');
    const { dataSource, query } = lockedRunner();

    await runTick({
      dataSource,
      lockName: job.lockName,
      jobName: job.name,
      run: job.run,
      logger: { info: jest.fn(), error: jest.fn() },
      metrics: { recordSuccess: jest.fn(), recordFailure: jest.fn() }
    });

    expect(job.lockName).toBe(LOCKS.refresh_cleanup);
    expect(job.lockName).not.toBe(LOCKS.webhook_retention);
    expect(query.mock.calls[0][1]).toEqual([LOCKS.refresh_cleanup]);
    expect(deleteExpired).toHaveBeenCalled();
  });

  test('deletes processed webhook events older than 90 days', async () => {
    const deleteProcessedBefore = jest.fn().mockResolvedValue(4);
    const now = new Date('2026-04-01T00:00:00Z');

    await expect(runWebhookRetention({ eventsRepository: { deleteProcessedBefore } }, now))
      .resolves.toEqual({ deleted: 4 });
    expect(deleteProcessedBefore).toHaveBeenCalledWith(new Date('2026-01-01T00:00:00Z'));
    expect(JOB_INTERVALS.webhook_retention).toBe(24 * 60 * 60 * 1000);
  });

  test('webhook retention takes its own lock', async () => {
    const deleteProcessedBefore = jest.fn().mockResolvedValue(0);
    const jobs = createJobDefinitions({
      eventsRepository: { deleteProcessedBefore },
      refreshTokenRepository: { deleteExpired: jest.fn() },
      stripeWebhookService: { retryPending: jest.fn() },
      transactionalMailer: { resendUnsent: jest.fn() },
      ledgerRepository: {},
      cursorRepository: { get: jest.fn(), set: jest.fn() },
      upsShipmentRepository: {},
      upsClient: {}
    });
    const job = jobs.find((item) => item.name === 'webhook_retention');
    const { dataSource, query } = lockedRunner();

    await runTick({
      dataSource,
      lockName: job.lockName,
      jobName: job.name,
      run: job.run,
      logger: { info: jest.fn(), error: jest.fn() },
      metrics: { recordSuccess: jest.fn(), recordFailure: jest.fn() }
    });

    expect(job.lockName).toBe(LOCKS.webhook_retention);
    expect(job.lockName).not.toBe(LOCKS.refresh_cleanup);
    expect(query.mock.calls[0][1]).toEqual([LOCKS.webhook_retention]);
    expect(deleteProcessedBefore).toHaveBeenCalled();
  });

  // customer-purchase-trail
  describe('purchase_trail_retention', () => {
    const { CustomerPurchaseTrailService } = require('../src/services/customer-purchase-trail.service');
    const DAY = 24 * 60 * 60 * 1000;
    const now = new Date('2026-11-19T00:00:00Z');

    function rows() {
      return [
        { id: 1, market: 'br', started_at: new Date(now.getTime() - 181 * DAY) },
        { id: 2, market: 'us', started_at: new Date(now.getTime() - 181 * DAY) },
        { id: 3, market: 'us', started_at: new Date(now.getTime() - 179 * DAY) }
      ];
    }

    test('runs daily on its own lock and deletes 181-day rows of both markets, keeping a 179-day one', async () => {
      let table = rows();
      const repository = {
        deleteOlderThan: jest.fn(async (cutoff, batch) => {
          const before = table.length;
          table = table.filter((row) => row.started_at >= cutoff);
          return { attempts: Math.min(before - table.length, batch), events: 0, config_events: 0 };
        })
      };
      const customerPurchaseTrailService = new CustomerPurchaseTrailService({ repository, now: () => now });
      const jobs = createJobDefinitions({
        customerPurchaseTrailService,
        eventsRepository: {},
        refreshTokenRepository: {},
        stripeWebhookService: {},
        transactionalMailer: {},
        ledgerRepository: {},
        cursorRepository: { get: jest.fn(), set: jest.fn() },
        upsShipmentRepository: {},
        upsClient: {}
      });
      const job = jobs.find((item) => item.name === 'purchase_trail_retention');
      expect(job.intervalMs).toBe(DAY);
      expect(job.lockName).toBe(LOCKS.purchase_trail_retention);
      expect(new Set(Object.values(LOCKS)).size).toBe(Object.values(LOCKS).length);

      await expect(job.run()).resolves.toMatchObject({ attempts: 2 });
      expect(table.map((row) => row.id)).toEqual([3]);
      // Idempotent: a second tick deletes nothing more.
      await expect(job.run()).resolves.toMatchObject({ attempts: 0 });
    });
  });
});
