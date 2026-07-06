import { AuditService } from './audit.service';

type PrismaMock = {
  auditLog: {
    create: jest.Mock;
  };
};

const makePrismaMock = (): PrismaMock => ({
  auditLog: {
    create: jest.fn(),
  },
});

describe('AuditService', () => {
  let prisma: PrismaMock;
  let service: AuditService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new AuditService(prisma as never);
  });

  it('record should persist the audit event with all fields', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'audit_1' });

    const output = await service.record({
      actorUserId: 'user_1',
      actorRole: 'admin',
      action: 'business_rules_config.update',
      resource: 'business_rules_config',
      resourceId: 'rule_1',
      beforeJson: { active: true },
      afterJson: { active: false },
      correlationId: 'corr_1',
    });

    expect(output).toEqual({ id: 'audit_1' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 'user_1',
        actorRole: 'admin',
        action: 'business_rules_config.update',
        resource: 'business_rules_config',
        resourceId: 'rule_1',
        beforeJson: { active: true },
        afterJson: { active: false },
        correlationId: 'corr_1',
      },
    });
  });

  it('record should omit optional json fields when they are absent', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'audit_2' });

    await service.record({
      action: 'order.status.update',
      resource: 'orders',
      resourceId: 'order_1',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorUserId: undefined,
        actorRole: undefined,
        action: 'order.status.update',
        resource: 'orders',
        resourceId: 'order_1',
        beforeJson: undefined,
        afterJson: undefined,
        correlationId: undefined,
      },
    });
  });
});
