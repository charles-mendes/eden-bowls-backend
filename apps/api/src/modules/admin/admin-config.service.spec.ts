import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

import { AdminConfigService } from './admin-config.service';

type PrismaMock = {
  businessRulesConfig: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

type AuditMock = {
  record: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  businessRulesConfig: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeAuditMock = (): AuditMock => ({
  record: jest.fn(),
});

describe('AdminConfigService', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: AdminConfigService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = new AdminConfigService(prisma as never, audit as never);
  });

  it('listBusinessRules should return paginated config rows', async () => {
    prisma.$transaction.mockResolvedValue([1, [{ id: 'rule_1' }]]);

    const output = await service.listBusinessRules({ domain: 'billing', page: 1, perPage: 20 });

    expect(prisma.businessRulesConfig.count).toHaveBeenCalledWith({ where: { domain: 'billing' } });
    expect(output).toEqual({
      total: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
      items: [{ id: 'rule_1' }],
    });
  });

  it('updateBusinessRule should reject missing rule', async () => {
    prisma.businessRulesConfig.findUnique.mockResolvedValue(null);

    await expect(service.updateBusinessRule('rule_1', {})).rejects.toThrow(NotFoundException);
  });

  it('updateBusinessRule should reject invalid effectiveTo values', async () => {
    prisma.businessRulesConfig.findUnique.mockResolvedValue({
      id: 'rule_1',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      active: true,
    });

    await expect(service.updateBusinessRule('rule_1', { effectiveTo: 'not-a-date' as never })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('updateBusinessRule should reject effectiveTo before effectiveFrom', async () => {
    prisma.businessRulesConfig.findUnique.mockResolvedValue({
      id: 'rule_1',
      domain: 'billing',
      key: 'plan_monthly',
      marketCountry: 'BR',
      effectiveFrom: new Date('2026-01-10T00:00:00.000Z'),
      effectiveTo: null,
      active: true,
    });

    await expect(
      service.updateBusinessRule('rule_1', { effectiveTo: '2026-01-01T00:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('updateBusinessRule should reject overlapping active rules', async () => {
    prisma.businessRulesConfig.findUnique.mockResolvedValue({
      id: 'rule_1',
      domain: 'billing',
      key: 'plan_monthly',
      marketCountry: 'BR',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      active: true,
    });
    prisma.businessRulesConfig.findFirst.mockResolvedValue({ id: 'rule_2' });

    await expect(
      service.updateBusinessRule('rule_1', { active: true }),
    ).rejects.toThrow(ConflictException);
  });

  it('updateBusinessRule should update and audit', async () => {
    const existing = {
      id: 'rule_1',
      domain: 'billing',
      key: 'plan_monthly',
      marketCountry: 'BR',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      active: true,
      valueJson: { enabled: false },
    };
    const updated = { ...existing, active: false };

    prisma.businessRulesConfig.findUnique.mockResolvedValue(existing);
    prisma.businessRulesConfig.findFirst.mockResolvedValue(null);
    prisma.businessRulesConfig.update.mockResolvedValue(updated);

    const output = await service.updateBusinessRule('rule_1', { active: false, valueJson: { enabled: true } });

    expect(output).toEqual(updated);
    expect(prisma.businessRulesConfig.update).toHaveBeenCalledWith({
      where: { id: 'rule_1' },
      data: expect.objectContaining({
        active: false,
        valueJson: { enabled: true },
      }),
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'business_rules_config.update',
        resource: 'business_rules_config',
        resourceId: 'rule_1',
      }),
    );
  });
});
