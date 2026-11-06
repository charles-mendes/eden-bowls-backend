const { BlingNfeRepository } = require('../src/infrastructure/repositories/bling-nfe.repository');
const { UpsShipmentRepository } = require('../src/infrastructure/repositories/ups-shipment.repository');

describe('counts for Today', () => {
  test('NF-e counts by status, missing statuses at 0', async () => {
    const query = jest.fn().mockResolvedValue([{ status: 'rejected', total: '2' }]);
    const repository = new BlingNfeRepository({ isInitialized: true, query });

    await expect(repository.countByStatuses(['blocked_missing_document', 'rejected', 'error'])).resolves.toEqual({ blocked_missing_document: 0, rejected: 2, error: 0 });
    expect(query.mock.calls[0][0]).toContain('`status` IN (?, ?, ?) GROUP BY `status`');
  });

  test('UPS counts pending and unknown purchases', async () => {
    const query = jest.fn().mockResolvedValue([{ total: 3 }]);
    const repository = new UpsShipmentRepository({ isInitialized: true, query });

    await expect(repository.countUnresolved()).resolves.toBe(3);
    expect(query.mock.calls[0][0]).toContain("`status` IN ('pending', 'unknown')");
  });
});
