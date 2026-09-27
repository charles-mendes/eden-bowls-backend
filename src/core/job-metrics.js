const client = require('prom-client');

function metric(name, create) {
  return client.register.getSingleMetric(name) || create();
}

const lastSuccess = metric('eden_job_last_success_timestamp', () => new client.Gauge({
  name: 'eden_job_last_success_timestamp',
  help: 'Unix timestamp of the last successful background job tick',
  labelNames: ['job']
}));

const itemsFailed = metric('eden_job_items_failed_total', () => new client.Counter({
  name: 'eden_job_items_failed_total',
  help: 'Background job items that failed',
  labelNames: ['job']
}));

function recordJobSuccess(job) {
  lastSuccess.set({ job }, Date.now() / 1000);
}

function recordJobItemsFailed(job, count) {
  const amount = Number(count) || 0;
  if (amount > 0) {
    itemsFailed.inc({ job }, amount);
  }
}

module.exports = {
  recordJobSuccess,
  recordJobItemsFailed
};
