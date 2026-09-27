const { recordJobItemsFailed, recordJobSuccess } = require('./job-metrics');

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

function startScheduler({ jobs, dataSource, logger, metrics }) {
  const timers = [];
  for (const job of jobs) {
    const tick = () => {
      runTick({
        dataSource,
        lockName: job.lockName,
        jobName: job.name,
        run: job.run,
        logger,
        metrics
      }).catch((error) => {
        logger.error({ err: error, job: job.name }, 'Background job tick failed');
      });
    };
    tick();
    timers.push(setInterval(tick, job.intervalMs));
  }

  return {
    stop() {
      for (const timer of timers) {
        clearInterval(timer);
      }
    }
  };
}

module.exports = {
  runTick,
  startScheduler
};
