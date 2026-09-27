function runtimePlan(env = {}) {
  const mode = String(env.MODE || 'http');
  const jobsEnabled = env.ENABLE_BACKGROUND_JOBS === true;
  if (mode === 'cron' || mode === 'worker') {
    return { listen: false, schedule: true };
  }
  if (mode === 'all') {
    return { listen: true, schedule: true };
  }
  return { listen: true, schedule: jobsEnabled };
}

function startProcess({ app, env, logger, onSchedule }) {
  const plan = runtimePlan(env);
  const log = logger || { info() {}, error() {} };
  if (plan.schedule && typeof onSchedule === 'function') {
    onSchedule();
  }
  if (!plan.listen) {
    log.info({ mode: env.MODE }, 'Background scheduler started.');
    return { plan, server: null };
  }

  const server = app.listen(env.PORT, () => {
    log.info({ port: env.PORT, mode: env.MODE }, 'Server started.');
  });
  server.on('error', (error) => {
    log.error(error, 'HTTP server failed to listen.');
    process.exit(1);
  });
  return { plan, server };
}

module.exports = {
  runtimePlan,
  startProcess
};
