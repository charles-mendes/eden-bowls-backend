const { AdminProductionService } = require('../src/services/admin-production.service');
const { HttpError } = require('../src/core/http-error');

function ledgerRow(overrides = {}) {
  return {
    id: 42,
    userId: 7,
    customerEmail: 'ana@edenbowls.com',
    stripeSubscriptionId: 'sub_123',
    stripeAccount: 'br',
    status: 'active',
    planLabel: 'Plano adulto',
    currentPeriodEnd: '2026-09-20T08:00:00.000Z',
    cancelAtPeriodEnd: false,
    address: { country: 'BR', city: 'São Paulo' },
    planSelection: {
      catalog_pricing: {
        subtotal: 189.9,
        currency: 'BRL',
        line_items: [
          { flavor: 'beef', quantity: 2, pack_size_label: '500 g', pet_name: 'Luna' }
        ]
      }
    },
    ...overrides
  };
}

function queueItem(overrides = {}) {
  return {
    ...ledgerRow(),
    productionStatus: 'to_prepare',
    note: null,
    displayName: 'Ana Costa',
    ...overrides
  };
}

describe('AdminProductionService', () => {
  test('advances a paid to_prepare cycle into in_production', async () => {
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue({ status: 'to_prepare', paidAt: '2026-09-20T08:01:00.000Z', periodEnd: '2026-09-20T08:00:00.000Z' }),
      upsert: jest.fn().mockResolvedValue({ status: 'in_production' })
    };
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(ledgerRow()),
        findQueueRowById: jest.fn().mockResolvedValue(queueItem({ productionStatus: 'in_production' }))
      },
      productionRepository,
      auditService: { record: jest.fn() }
    });

    const result = await service.updateStatus(42, {
      status: 'in_production',
      periodEnd: '2026-09-20T08:00:00.000Z'
    }, { userId: 7 });

    expect(result.productionStatus).toBe('in_production');
    expect(productionRepository.upsert).toHaveBeenCalled();
  });

  test('a trialing subscription after a skip advances in the queue like an active one, a canceled one does not', async () => {
    const build = (status) => {
      const productionRepository = {
        findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(status === 'trialing' ? { status: 'to_prepare', paidAt: '2026-09-20T08:01:00.000Z', periodEnd: '2026-09-20T08:00:00.000Z' } : null),
        upsert: jest.fn().mockResolvedValue({ status: 'in_production' })
      };
      const service = new AdminProductionService({
        now: () => new Date('2026-09-20T15:00:00.000Z'),
        ledgerRepository: {
          findById: jest.fn().mockResolvedValue(ledgerRow({ status })),
          findQueueRowById: jest.fn().mockResolvedValue(queueItem({ status, productionStatus: 'in_production' }))
        },
        productionRepository,
        auditService: { record: jest.fn() }
      });
      return { service, productionRepository };
    };
    const body = { status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' };

    const trialing = build('trialing');
    await expect(trialing.service.updateStatus(42, body, { userId: 7 }))
      .resolves.toMatchObject({ productionStatus: 'in_production' });
    expect(trialing.productionRepository.upsert).toHaveBeenCalled();

    const canceled = build('canceled');
    await expect(canceled.service.updateStatus(42, body, { userId: 7 }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'production_not_eligible' } });
    expect(canceled.productionRepository.upsert).not.toHaveBeenCalled();
  });

  test('does not send a shipped letter when production status changes', async () => {
    const notifyShipped = jest.fn();
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(ledgerRow()),
        findQueueRowById: jest.fn().mockResolvedValue(queueItem({ productionStatus: 'ready' }))
      },
      productionRepository: {
        findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue({ status: 'in_production' }),
        upsert: jest.fn().mockResolvedValue({ status: 'ready' })
      },
      auditService: { record: jest.fn() }
    });
    service.transactionalMailer = { notifyShipped };

    const result = await service.updateStatus(42, {
      status: 'ready',
      periodEnd: '2026-09-20T08:00:00.000Z'
    }, { userId: 7 });

    expect(result.productionStatus).toBe('ready');
    expect(notifyShipped).not.toHaveBeenCalled();
    expect(service.notifyShippedMail).toBeUndefined();
  });

  test('lists a paginated envelope with metrics', async () => {
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: {
        listQueue: jest.fn().mockResolvedValue({ total: 1, items: [queueItem()] }),
        listQueueMetricRows: jest.fn().mockResolvedValue([
          { current_period_end: '2026-09-20T08:00:00.000Z', production_status: 'to_prepare' },
          { current_period_end: '2026-09-22T08:00:00.000Z', production_status: 'to_prepare' }
        ])
      }
    });

    const result = await service.listQueue({ windowDays: 7, includeOverdue: true }, { page: 1, perPage: 20, offset: 0 });

    expect(result.total).toBe(1);
    expect(result.items[0].productionStatus).toBe('to_prepare');
    expect(result.metrics).toEqual({ today: 1, tomorrow: 0, upcoming: 1, overdue: 0 });
  });

  test('names queue recipes from the current catalog, and still lists when the names fail to load', async () => {
    const ledgerRepository = {
      listQueue: jest.fn().mockResolvedValue({ total: 1, items: [queueItem()] }),
      listQueueMetricRows: jest.fn().mockResolvedValue([])
    };
    const named = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository,
      recipeNamesRepository: { listRecipeNames: jest.fn().mockResolvedValue({ BR: { beef: { label: 'Bovino', shortLabel: '' } } }) }
    });
    const result = await named.listQueue({ windowDays: 7 }, { page: 1, perPage: 20, offset: 0 });
    expect(result.items[0].flavorMix).toBe('Bovino × 2');

    const failing = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository,
      recipeNamesRepository: { listRecipeNames: jest.fn().mockRejectedValue(new Error('db down')) }
    });
    const fallback = await failing.listQueue({ windowDays: 7 }, { page: 1, perPage: 20, offset: 0 });
    expect(fallback.items[0].flavorMix).toBe('beef × 2');
  });

  test('passes the due bucket and brings overdue rows back when that bucket is asked for', async () => {
    const listQueue = jest.fn().mockResolvedValue({ total: 0, items: [] });
    const listQueueMetricRows = jest.fn().mockResolvedValue([]);
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: { listQueue, listQueueMetricRows }
    });

    await service.listQueue({ windowDays: 7, includeOverdue: false, due: 'overdue' }, { page: 1, perPage: 20, offset: 0 });

    expect(listQueue).toHaveBeenCalledWith(expect.objectContaining({
      due: 'overdue',
      includeOverdue: true,
      startOfTomorrow: '2026-09-21 03:00:00',
      startOfDayAfterTomorrow: '2026-09-22 03:00:00'
    }));
    // The bucket counts stay the same whatever bucket the list shows.
    expect(listQueueMetricRows).toHaveBeenCalledWith(expect.not.objectContaining({ due: expect.anything() }));
  });

  test('blocks in_production when a note is provided', async () => {
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue({ status: 'in_production' }),
      upsert: jest.fn().mockResolvedValue({ status: 'blocked' })
    };
    const auditService = { record: jest.fn() };
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(ledgerRow()),
        findQueueRowById: jest.fn().mockResolvedValue(queueItem({ productionStatus: 'blocked', note: 'Falta estoque de peru' }))
      },
      productionRepository,
      auditService
    });

    const result = await service.updateStatus(42, {
      status: 'blocked',
      periodEnd: '2026-09-20T08:00:00.000Z',
      note: 'Falta estoque de peru'
    }, { userId: 7, email: 'ops@edenbowls.com' });

    expect(result.productionStatus).toBe('blocked');
    expect(productionRepository.upsert).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'production.status.update'
    }));
  });

  test('rejects a blocked transition without a note at the validator, not by writing the cycle', async () => {
    const { parseProductionQueuePatch } = require('../src/api/validators/admin-production.validator');
    expect(() => parseProductionQueuePatch({
      status: 'blocked',
      periodEnd: '2026-09-20T08:00:00.000Z'
    })).toThrow(HttpError);
  });

  test('returns 409 when periodEnd is stale', async () => {
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn(),
      upsert: jest.fn()
    };
    const service = new AdminProductionService({
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(ledgerRow())
      },
      productionRepository
    });

    await expect(service.updateStatus(42, {
      status: 'in_production',
      periodEnd: '2026-10-20T08:00:00.000Z'
    })).rejects.toMatchObject({ statusCode: 409, details: { code: 'production_period_stale' } });
    expect(productionRepository.upsert).not.toHaveBeenCalled();
  });

  test('returns 409 when cancel_at_period_end excludes the unpaid row', async () => {
    const productionRepository = { findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(null), upsert: jest.fn() };
    const service = new AdminProductionService({
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(ledgerRow({ cancelAtPeriodEnd: true }))
      },
      productionRepository
    });

    await expect(service.updateStatus(42, {
      status: 'in_production',
      periodEnd: '2026-09-20T08:00:00.000Z'
    })).rejects.toMatchObject({ statusCode: 409 });
    expect(productionRepository.upsert).not.toHaveBeenCalled();
  });

  test('reopens a ready cycle into in_production', async () => {
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue({ status: 'ready', paidAt: '2026-09-20T08:01:00.000Z', periodEnd: '2026-09-20T08:00:00.000Z' }),
      upsert: jest.fn().mockResolvedValue({ status: 'in_production' })
    };
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: {
        findById: jest.fn().mockResolvedValue(ledgerRow()),
        findQueueRowById: jest.fn().mockResolvedValue(queueItem({ productionStatus: 'in_production' }))
      },
      productionRepository,
      auditService: { record: jest.fn() }
    });

    const result = await service.updateStatus(42, {
      status: 'in_production',
      periodEnd: '2026-09-20T08:00:00.000Z'
    }, { userId: 7 });

    expect(result.productionStatus).toBe('in_production');
  });

  test('forces stripe accounts on the production queue and 404s a US row for a Brazil operator', async () => {
    const listQueue = jest.fn().mockResolvedValue({ total: 0, items: [] });
    const listQueueMetricRows = jest.fn().mockResolvedValue([]);
    const productionRepository = { findBySubscriptionAndPeriodEnd: jest.fn(), upsert: jest.fn() };
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: {
        listQueue,
        listQueueMetricRows,
        findById: jest.fn().mockResolvedValue(ledgerRow({ stripeAccount: 'us' }))
      },
      productionRepository
    });
    const actor = { roles: ['operator'], markets: ['BR'] };

    await service.listQueue({ windowDays: 7, includeOverdue: true }, { page: 1, perPage: 20, offset: 0 }, actor);

    expect(listQueue).toHaveBeenCalledWith(expect.objectContaining({ stripeAccounts: ['br'] }));
    await expect(service.updateStatus(91, {
      status: 'in_production',
      periodEnd: '2026-09-20T08:00:00.000Z'
    }, actor)).rejects.toMatchObject({ statusCode: 404 });
    expect(productionRepository.upsert).not.toHaveBeenCalled();
  });
});

describe('AdminProductionService payment gate (3.12, 3.13)', () => {
  function build({ row = ledgerRow(), cycle = null } = {}) {
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(cycle),
      upsert: jest.fn().mockResolvedValue({})
    };
    const findQueueRowById = jest.fn().mockResolvedValue(queueItem({ productionStatus: 'in_production' }));
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository: { findById: jest.fn().mockResolvedValue(row), findQueueRowById },
      productionRepository,
      auditService: { record: jest.fn() }
    });
    return { service, productionRepository, findQueueRowById };
  }

  test('an unpaid cycle awaiting payment cannot move to in_production', async () => {
    const { service, productionRepository } = build();
    await expect(service.updateStatus(42, { status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' }, { userId: 7 }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'production_awaiting_payment' } });
    expect(productionRepository.upsert).not.toHaveBeenCalled();
  });

  test('a past_due cycle is the failed renewal and is not produced until paid', async () => {
    const row = ledgerRow({ status: 'past_due', currentPeriodStart: '2026-09-20T08:00:00.000Z', currentPeriodEnd: '2026-10-20T08:00:00.000Z' });
    const { service } = build({ row });
    await expect(service.updateStatus(42, { status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' }, { userId: 7 }))
      .rejects.toMatchObject({ statusCode: 409, details: { code: 'production_awaiting_payment' } });
    // An unpaid cycle can still be held before payment.
    const held = build({ row });
    await held.service.updateStatus(42, { status: 'blocked', periodEnd: '2026-09-20T08:00:00.000Z', note: 'card' }, { userId: 7 });
    expect(held.productionRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'blocked' }));
  });

  test('the paid last delivery stays workable after cancel_at_period_end, at its own cycle key', async () => {
    const row = ledgerRow({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-10-20T08:00:00.000Z' });
    const cycle = { status: 'to_prepare', paidAt: '2026-09-20T08:01:00.000Z', periodEnd: '2026-09-20T08:00:00.000Z' };
    const { service, productionRepository, findQueueRowById } = build({ row, cycle });
    await service.updateStatus(42, { status: 'in_production', periodEnd: '2026-09-20T08:00:00.000Z' }, { userId: 7 });
    expect(productionRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      periodEnd: '2026-09-20T08:00:00.000Z',
      status: 'in_production'
    }));
    expect(findQueueRowById).toHaveBeenCalledWith(42, '2026-09-20T08:00:00.000Z');
  });
});

// Stock storage kept in memory, with the same contract as PackStockRepository.
function memoryStock(onHand = {}) {
  const balances = new Map(Object.entries(onHand));
  const movements = [];
  const repository = {
    available: true,
    movements,
    balance: (key) => balances.get(key) || 0,
    isAvailable: jest.fn(async () => repository.available),
    transaction: jest.fn(async (work) => work({ transaction: true })),
    listItems: jest.fn(async (market) => [...balances.entries()]
      .filter(([key]) => key.startsWith(`${market}|`))
      .map(([key, value]) => {
        const [, flavorKey, grams] = key.split('|');
        return { flavorKey, packSizeGrams: Number(grams), onHand: value };
      })),
    applyMovements: jest.fn(async (_manager, list) => {
      const touched = new Map();
      for (const movement of list) {
        const key = `${movement.market}|${movement.flavorKey}|${movement.packSizeGrams}`;
        balances.set(key, (balances.get(key) || 0) + movement.quantity);
        movements.push(movement);
        touched.set(key, { market: movement.market, flavorKey: movement.flavorKey, packSizeGrams: movement.packSizeGrams, onHand: balances.get(key) });
      }
      return [...touched.values()];
    }),
    openSeparationsForCycle: jest.fn(async (_manager, cycleId) => {
      const open = new Map();
      for (const movement of movements) {
        if (movement.productionCycleId !== cycleId || !['separation', 'separation_reversal'].includes(movement.type)) continue;
        const key = `${movement.market}|${movement.flavorKey}|${movement.packSizeGrams}`;
        const entry = open.get(key) || { market: movement.market, flavorKey: movement.flavorKey, packSizeGrams: movement.packSizeGrams, quantity: 0 };
        entry.quantity += movement.quantity;
        open.set(key, entry);
      }
      return [...open.values()].filter((entry) => entry.quantity !== 0);
    })
  };
  return repository;
}

describe('AdminProductionService pack stock', () => {
  const { AdminPackStockService } = require('../src/services/admin-pack-stock.service');
  const periodEnd = '2026-09-20T08:00:00.000Z';
  const packs = (lines) => ({ catalog_pricing: { line_items: lines } });

  function build({ stock = memoryStock(), fromStatus = 'in_production', lines, demandRows = [], page = [] } = {}) {
    const cycleState = { status: fromStatus };
    const queueRow = { lines: lines || [{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }, { flavor: 'carne', quantity: 2, pack_size_grams: 300 }] };
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn(async () => ({ id: 9, status: cycleState.status, paidAt: '2026-09-20T08:01:00.000Z', periodEnd })),
      upsert: jest.fn(async (input) => {
        cycleState.status = input.status;
        return { id: 9, status: input.status };
      })
    };
    const ledgerRepository = {
      findById: jest.fn().mockResolvedValue(ledgerRow()),
      findQueueRowById: jest.fn(async () => queueItem({ productionStatus: cycleState.status, planSelection: packs(queueRow.lines) })),
      listQueue: jest.fn().mockResolvedValue({ total: demandRows.length, items: page }),
      listQueueMetricRows: jest.fn().mockResolvedValue([]),
      listQueueDemandRows: jest.fn().mockResolvedValue(demandRows)
    };
    const packStock = new AdminPackStockService({ stockRepository: stock, ledgerRepository, logger: { warn: jest.fn() } });
    const service = new AdminProductionService({
      now: () => new Date('2026-09-20T15:00:00.000Z'),
      ledgerRepository,
      productionRepository,
      packStock,
      auditService: { record: jest.fn() }
    });
    const move = (status) => service.updateStatus(42, { status, periodEnd }, { userId: 7 });
    return { service, stock, productionRepository, queueRow, cycleState, move };
  }

  test('Cycle separated', async () => {
    const { stock, productionRepository, move } = build({ stock: memoryStock({ 'BR|frango|300': 10, 'BR|carne|300': 10 }) });

    const result = await move('ready');

    expect(result.productionStatus).toBe('ready');
    expect(stock.balance('BR|frango|300')).toBe(6);
    expect(stock.balance('BR|carne|300')).toBe(8);
    expect(stock.movements).toEqual([
      expect.objectContaining({ type: 'separation', flavorKey: 'frango', quantity: -4, productionCycleId: 9, subscriptionId: 42 }),
      expect.objectContaining({ type: 'separation', flavorKey: 'carne', quantity: -2, productionCycleId: 9, subscriptionId: 42 })
    ]);
    expect(productionRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }), { manager: { transaction: true } });
    expect(result.stock).toEqual({ shortages: [], unsized: 0 });
  });

  test('Ready sent twice', async () => {
    const { stock, cycleState, move } = build({ stock: memoryStock({ 'BR|frango|300': 10, 'BR|carne|300': 10 }) });

    await move('ready');
    cycleState.status = 'in_production';
    await move('ready');

    expect(stock.movements).toHaveLength(2);
    expect(stock.balance('BR|frango|300')).toBe(6);
  });

  test('Return after a pack change', async () => {
    const { stock, queueRow, move } = build({ stock: memoryStock({ 'BR|frango|300': 10 }), lines: [{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }] });

    await move('ready');
    queueRow.lines = [{ flavor: 'frango', quantity: 6, pack_size_grams: 300 }];
    await move('in_production');
    expect(stock.movements[1]).toMatchObject({ type: 'separation_reversal', quantity: 4 });
    expect(stock.balance('BR|frango|300')).toBe(10);

    await move('ready');
    expect(stock.movements[2]).toMatchObject({ type: 'separation', quantity: -6 });
    expect(stock.balance('BR|frango|300')).toBe(4);
  });

  test('Separation with too little stock', async () => {
    const { move } = build({ stock: memoryStock({ 'BR|frango|300': 2 }), lines: [{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }] });

    const result = await move('ready');

    expect(result.productionStatus).toBe('ready');
    expect(result.stock).toEqual({ shortages: [{ flavorKey: 'frango', packSizeGrams: 300, onHand: -2 }], unsized: 0 });
  });

  test('a line without a size is skipped and counted', async () => {
    const { stock, move } = build({ lines: [{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }, { flavor: 'carne', quantity: 1 }] });

    const result = await move('ready');

    expect(stock.movements).toHaveLength(1);
    expect(result.stock.unsized).toBe(1);
  });

  test('Status change after a migration rollback', async () => {
    const stock = memoryStock();
    stock.available = false;
    const queued = queueItem({ productionStatus: 'in_production', planSelection: packs([{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }]) });
    const { service, productionRepository, move } = build({ stock, demandRows: [queued], page: [queued] });

    const result = await move('ready');
    const queue = await service.listQueue({ windowDays: 7, includeOverdue: true }, { page: 1, perPage: 20, offset: 0 });

    expect(result.productionStatus).toBe('ready');
    expect(result.stock).toEqual({ shortages: [], unsized: 0 });
    expect(stock.transaction).not.toHaveBeenCalled();
    expect(productionRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }));
    expect(queue.items[0].stockCoverage).toBeNull();
  });

  test('transitions that do not touch ready write no movement', async () => {
    const { stock, move } = build({ fromStatus: 'to_prepare' });

    await move('in_production');

    expect(stock.transaction).not.toHaveBeenCalled();
    expect(stock.movements).toEqual([]);
  });

  test('Earlier delivery takes the stock first', async () => {
    const row = (id, dueAt) => queueItem({
      id,
      currentPeriodEnd: dueAt,
      cyclePeriodEnd: dueAt,
      dueAt,
      productionStatus: 'to_prepare',
      paymentState: 'paid',
      planSelection: packs([{ flavor: 'frango', quantity: 4, pack_size_grams: 300 }])
    });
    const sooner = row(41, '2026-09-21T15:00:00.000Z');
    const later = row(42, '2026-09-23T15:00:00.000Z');
    const { service } = build({ stock: memoryStock({ 'BR|frango|300': 5 }), demandRows: [sooner, later], page: [later] });

    const queue = await service.listQueue({ windowDays: 7, includeOverdue: true }, { page: 2, perPage: 1, offset: 1 });

    expect(queue.items.map((item) => [item.id, item.stockCoverage])).toEqual([[42, 'short']]);
  });
});
