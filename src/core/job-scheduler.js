const { recordJobItemsFailed, recordJobSuccess } = require('./job-metrics');

// Each tick holds one pooled connection for its GET_LOCK while the job body needs
// others. Running every job at once takes the whole pool and freezes the process.
const MAX_CONCURRENT_JOBS = 3;

async function runTick({ dataSource, lockName, jobName, run, logger, metrics }) {
  const started = Date.now();
  const log = logger || { info() {}, error() {} };
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  let locked = false;

  try {
    const rows = await queryRunner.query('SELECT GET_LOCK(?, 0) AS locked', [lockName]);
    locked = Number(rows && rows[0] && rows[0].locked) === 1;
    if (!locked) {
      return { skipped: true };
    }

    let counts;
    try {
      counts = await run();
    } catch (error) {
      log.error({
        job: jobName,
        durationMs: Date.now() - started,
        err: error
      }, 'Background job tick failed');
      return { skipped: false, error };
    }

    const durationMs = Date.now() - started;
    log.info({ job: jobName, durationMs, ...(counts || {}) }, 'Background job tick');
    const recordSuccess = metrics && metrics.recordSuccess ? metrics.recordSuccess : recordJobSuccess;
    const recordFailure = metrics && metrics.recordFailure ? metrics.recordFailure : recordJobItemsFailed;
    recordSuccess(jobName);
    const failed = Number(counts && counts.failed) || 0;
    if (failed > 0) {
      recordFailure(jobName, failed);
    }
    return { skipped: false, counts, durationMs };
  } finally {
    if (locked) {
      try {
        await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockName]);
      } catch (_error) {
        // The connection drop releases a MySQL named lock.
      }
    }
    await queryRunner.release();
  }
}

function startScheduler({ jobs, dataSource, logger, metrics, maxConcurrent = MAX_CONCURRENT_JOBS }) {
  const timers = [];
  const waiting = [];
  const scheduled = new Set();
  let active = 0;

  const drain = () => {
    while (active < maxConcurrent && waiting.length) {
      const job = waiting.shift();
      active += 1;
      runTick({
        dataSource,
        lockName: job.lockName,
        jobName: job.name,
        run: job.run,
        logger,
        metrics
      }).catch((error) => {
        logger.error({ err: error, job: job.name }, 'Background job tick failed');
      }).finally(() => {
        active -= 1;
        scheduled.delete(job.name);
        drain();
      });
    }
  };

  for (const job of jobs) {
    const tick = () => {
      if (scheduled.has(job.name)) {
        return;
      }
      scheduled.add(job.name);
      waiting.push(job);
      drain();
    };
    tick();
    timers.push(setInterval(tick, job.intervalMs));
  }

  return {
    stop() {
      for (const timer of timers) {
        clearInterval(timer);
      }
      waiting.length = 0;
    }
  };
}

module.exports = {
  MAX_CONCURRENT_JOBS,
  runTick,
  startScheduler
};
