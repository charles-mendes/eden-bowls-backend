const { AdminPackStockService } = require('../src/services/admin-pack-stock.service');
const { parseStockAdjustment, parseStockProduction } = require('../src/api/validators/admin-pack-stock.validator');

const operatorBr = { userId: 7, roles: ['operator'], markets: ['BR'] };

function stockRepository(overrides = {}) {
  const manager = { query: jest.fn() };
  return {
    manager,
    isAvailable: jest.fn().mockResolvedValue(true),
    findItem: jest.fn().mockResolvedValue(null),
    listItems: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((work) => work(manager)),
    applyMovements: jest.fn(async (_manager, movements) => movements.map((movement) => ({
      market: movement.market,
      flavorKey: movement.flavorKey,
      packSizeGrams: movement.packSizeGrams,
      onHand: movement.quantity
    }))),
    setMinimum: jest.fn(),
    ...overrides
  };
}

function build({ repository = stockRepository(), sizes = ['frango|300', 'carne|500'], rows = [], logger } = {}) {
  const auditService = { record: jest.fn() };
  const service = new AdminPackStockService({
    stockRepository: repository,
    catalogRepository: { listRecipeSizes: jest.fn().mockResolvedValue(new Set(sizes)) },
    ledgerRepository: { listQueueDemandRows: jest.fn().mockResolvedValue(rows) },
    auditService,
    logger: logger || { warn: jest.fn() },
    now: () => new Date('2026-10-20T15:00:00.000Z')
  });
  return { service, repository, auditService };
}

describe('AdminPackStockService', () => {
  test('Known recipe and size', async () => {
    const { service, repository } = build();

    const item = await service.recordProduction(parseStockProduction({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: 12 }), operatorBr);

    expect(item).toMatchObject({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300 });
    expect(repository.applyMovements).toHaveBeenCalled();
  });

  test('Size not sold in the market', async () => {
    const { service, repository } = build();

    await expect(service.recordProduction(parseStockProduction({ market: 'BR', flavorKey: 'frango', packSizeGrams: 750, quantity: 1 }), operatorBr))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'stock_item_unknown' } });
    expect(repository.applyMovements).not.toHaveBeenCalled();
  });

  test('an item that already exists is accepted after its recipe leaves the catalog', async () => {
    const repository = stockRepository({ findItem: jest.fn().mockResolvedValue({ id: 3 }) });
    const { service } = build({ repository, sizes: [] });

    await expect(service.recordProduction(parseStockProduction({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: 1 }), operatorBr))
      .resolves.toBeTruthy();
  });

  test('Kitchen records a batch', async () => {
    const { service, repository, auditService } = build();

    await service.recordProduction(parseStockProduction({ market: 'BR', flavorKey: 'carne', packSizeGrams: 500, quantity: 30 }), operatorBr);

    expect(repository.applyMovements.mock.calls[0][1]).toEqual([
      expect.objectContaining({ type: 'production', quantity: 30, actorUserId: 7, market: 'BR', flavorKey: 'carne', packSizeGrams: 500 })
    ]);
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'stock.production' }));
  });

  test('Zero quantity', () => {
    expect(() => parseStockProduction({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: 0 }))
      .toThrow(expect.objectContaining({ statusCode: 400 }));
  });

  test('Expired packs written off', async () => {
    const { service, repository, auditService } = build({ sizes: ['chicken|454'] });
    const operatorUs = { userId: 8, roles: ['operator'], markets: ['US'] };

    await service.recordAdjustment(parseStockAdjustment({ market: 'US', flavorKey: 'chicken', packSizeGrams: 454, quantity: -5, reason: 'expired' }), operatorUs);

    expect(repository.applyMovements.mock.calls[0][1][0]).toMatchObject({ type: 'adjustment', quantity: -5, reason: 'expired' });
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'stock.adjustment' }));
  });

  test('Other without note', () => {
    expect(() => parseStockAdjustment({ market: 'BR', flavorKey: 'frango', packSizeGrams: 300, quantity: -1, reason: 'other' }))
      .toThrow(expect.objectContaining({ statusCode: 400, details: { code: 'stock_adjustment_note_required' } }));
  });

  test('Operator BR cannot move US stock', async () => {
    const { service, repository } = build({ sizes: ['chicken|454'] });

    await expect(service.recordProduction(parseStockProduction({ market: 'US', flavorKey: 'chicken', packSizeGrams: 454, quantity: 3 }), operatorBr))
      .rejects.toMatchObject({ statusCode: 403, details: { code: 'market_forbidden' } });
    expect(repository.applyMovements).not.toHaveBeenCalled();
  });

  test('an admin who sees both markets has to name one', async () => {
    const { service } = build();

    await expect(service.overview({ windowDays: 7 }, { userId: 1, roles: ['admin'] }))
      .rejects.toMatchObject({ statusCode: 400, details: { code: 'stock_market_required' } });
  });

  test('the overview sums the window and logs each line without a size with its subscription', async () => {
    const logger = { warn: jest.fn() };
    const queueRow = (id, lineItems) => ({
      id,
      stripeAccount: 'br',
      status: 'active',
      currentPeriodEnd: '2026-10-22T08:00:00.000Z',
      cyclePeriodEnd: '2026-10-22T08:00:00.000Z',
      dueAt: '2026-10-22T08:00:00.000Z',
      productionStatus: 'to_prepare',
      paymentState: 'awaiting_payment',
      planSelection: { catalog_pricing: { line_items: lineItems } }
    });
    const { service } = build({
      logger,
      rows: [
        queueRow(41, [{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }]),
        queueRow(42, [{ flavor: 'frango', flavor_label: 'Frango', quantity: 3 }])
      ]
    });

    const overview = await service.overview({ market: 'BR', windowDays: 7 }, operatorBr);

    expect(overview.items).toEqual([expect.objectContaining({ flavorKey: 'frango', packSizeGrams: 300, committed: 4, committedAwaitingPayment: 4 })]);
    expect(overview.unsizedLines).toEqual([expect.objectContaining({ subscriptionId: 42, quantity: 3 })]);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'stock.unsized_line', subscriptionId: 42 }), 'stock.unsized_line');
  });
});
