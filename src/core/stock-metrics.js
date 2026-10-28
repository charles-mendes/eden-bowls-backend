const client = require('prom-client');

function metric(name, create) {
  return client.register.getSingleMetric(name) || create();
}

const coverageDuration = metric('eden_stock_coverage_duration_seconds', () => new client.Histogram({
  name: 'eden_stock_coverage_duration_seconds',
  help: 'Time to load the queue window and compute stock demand or coverage',
  labelNames: ['source'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
}));

const demandRows = metric('eden_stock_demand_rows', () => new client.Gauge({
  name: 'eden_stock_demand_rows',
  help: 'Queue rows loaded by the last stock demand or coverage computation',
  labelNames: ['source']
}));

// `source` is `queue` (coverage on the production queue) or `overview` (the stock screen).
async function measureStockComputation(source, run) {
  const stop = coverageDuration.startTimer({ source });
  try {
    const result = await run();
    if (result && Number.isFinite(result.rowCount)) {
      demandRows.set({ source }, result.rowCount);
    }
    return result;
  } finally {
    stop();
  }
}

module.exports = {
  measureStockComputation
};
