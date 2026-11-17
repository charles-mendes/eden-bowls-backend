const { MAX_CONCURRENT_JOBS, runTick, startScheduler } = require('../src/core/job-scheduler');
const { createJobDefinitions } = require('../src/services/background-jobs.service');

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function pooledDataSource(limit) {
  let free = limit;
  const waiters = [];
  const release = async () => {
    const next = waiters.shift();
    if (next) {
      next();
    } else {
      free += 1;
    }
  };
  const acquire = () => {
    if (free > 0) {
      free -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  };
  return {
    acquire,
    release,
    createQueryRunner: () => ({
      connect: acquire,
      query: async (sql) => (sql.includes('GET_LOCK') ? [{ locked: 1 }] : []),
      release
    })
  };
}

describe('job scheduler concurrency', () => {
  test('finishes every registered job on the default pool of 10 connections', async () => {
    const dataSource = pooledDataSource(10);
    const logger = { info: jest.fn(), error: jest.fn() };
    const finished = [];
    const jobs = createJobDefinitions({ cursorRepository: {} }).map((job) => ({
      ...job,
      intervalMs: 3600 * 1000,
      run: async () => {
        await dataSource.acquire();
        await flush();
        await dataSource.release();
        finished.push(job.name);
        return {};
      }
    }));

    const scheduler = startScheduler({ jobs, dataSource, logger });
    for (let i = 0; i < 100 && finished.length < jobs.length; i += 1) {
      await flush();
    }
    scheduler.stop();

    expect(finished.sort()).toEqual(jobs.map((job) => job.name).sort());
  });

  test('never runs more jobs at once than the limit and does not stack a running job', async () => {
    const dataSource = pooledDataSource(10);
    const logger = { info: jest.fn(), error: jest.fn() };
    let running = 0;
    let peak = 0;
    const gates = [];
    const run = jest.fn(() => {
      running += 1;
      peak = Math.max(peak, running);
      return new Promise((resolve) => gates.push(() => {
        running -= 1;
        resolve({});
      }));
    });
    const jobs = Array.from({ length: MAX_CONCURRENT_JOBS + 2 }, (_, index) => ({
      name: `job_${index}`,
      lockName: `lock_${index}`,
      intervalMs: 5,
      run
    }));

    const scheduler = startScheduler({ jobs, dataSource, logger });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(run).toHaveBeenCalledTimes(MAX_CONCURRENT_JOBS);
    expect(peak).toBe(MAX_CONCURRENT_JOBS);

    scheduler.stop();
    while (gates.length) {
      gates.shift()();
      await flush();
      await flush();
    }
    expect(peak).toBe(MAX_CONCURRENT_JOBS);
  });
});

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
