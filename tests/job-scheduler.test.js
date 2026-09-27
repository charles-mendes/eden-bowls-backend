const { runTick } = require('../src/core/job-scheduler');

function runner(lockValue) {
  const query = jest.fn()
    .mockResolvedValueOnce([{ locked: lockValue }])
    .mockResolvedValueOnce([]);
  const queryRunner = {
    connect: jest.fn().mockResolvedValue(undefined),
    query,
    release: jest.fn().mockResolvedValue(undefined)
  };
  return {
    dataSource: { createQueryRunner: () => queryRunner },
    query
  };
}

describe('job scheduler', () => {
  test('skips the job body when the lock is held', async () => {
    const { dataSource, query } = runner(0);
    const run = jest.fn();

    await expect(runTick({
      dataSource,
      lockName: 'eden_job_webhook_retry',
      jobName: 'webhook_retry',
      run,
      logger: { info: jest.fn(), error: jest.fn() }
    })).resolves.toEqual({ skipped: true });

    expect(run).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('GET_LOCK');
  });

  test('does not reject the loop when the job body throws and still releases the lock', async () => {
    const { dataSource, query } = runner(1);
    const logger = { info: jest.fn(), error: jest.fn() };

    await expect(runTick({
      dataSource,
      lockName: 'eden_job_mail_resend',
      jobName: 'mail_resend',
      run: () => { throw new Error('tick failed'); },
      logger
    })).resolves.toEqual({ skipped: false, error: expect.any(Error) });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'mail_resend', durationMs: expect.any(Number) }),
      'Background job tick failed'
    );
    expect(query.mock.calls[1][0]).toContain('RELEASE_LOCK');
    expect(runTick.toString()).not.toContain('setTimeout');
  });

  test('logs the job name and duration when the tick finishes', async () => {
    const { dataSource } = runner(1);
    const logger = { info: jest.fn(), error: jest.fn() };

    await runTick({
      dataSource,
      lockName: 'eden_job_ups_tracking',
      jobName: 'ups_tracking',
      run: async () => ({ scanned: 1, updated: 1, failed: 0 }),
      logger,
      metrics: { recordSuccess: jest.fn(), recordFailure: jest.fn() }
    });

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ job: 'ups_tracking', durationMs: expect.any(Number), scanned: 1 }),
      'Background job tick'
    );
  });

  test('counts failed items and does not fold exhausted into failed', async () => {
    const { dataSource } = runner(1);
    const metrics = { recordSuccess: jest.fn(), recordFailure: jest.fn() };

    await runTick({
      dataSource,
      lockName: 'eden_job_mail_resend',
      jobName: 'mail_resend',
      run: async () => ({ sent: 0, failed: 0, exhausted: 1 }),
      logger: { info: jest.fn(), error: jest.fn() },
      metrics
    });

    expect(metrics.recordFailure).not.toHaveBeenCalled();
  });
});
