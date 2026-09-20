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
  test('advances to_prepare into in_production', async () => {
    const productionRepository = {
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue(null),
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

  test('returns 409 when cancel_at_period_end excludes the row', async () => {
    const productionRepository = { upsert: jest.fn() };
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
      findBySubscriptionAndPeriodEnd: jest.fn().mockResolvedValue({ status: 'ready' }),
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
