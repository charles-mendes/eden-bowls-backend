const client = require('prom-client');
const { AdminPackStockService } = require('../src/services/admin-pack-stock.service');

describe('stock metrics', () => {
  test('an overview records the coverage duration and the demand rows with source="overview"', async () => {
    const service = new AdminPackStockService({
      stockRepository: { listItems: jest.fn().mockResolvedValue([]) },
      ledgerRepository: { listQueueDemandRows: jest.fn().mockResolvedValue([]) },
      now: () => new Date('2026-10-20T15:00:00.000Z')
    });

    await service.overview({ market: 'BR', windowDays: 7 }, { userId: 7, roles: ['operator'], markets: ['BR'] });

    const metrics = await client.register.metrics();
    expect(metrics).toMatch(/eden_stock_coverage_duration_seconds_count\{source="overview"\} 1/);
    expect(metrics).toMatch(/eden_stock_demand_rows\{source="overview"\} 0/);
  });
});
