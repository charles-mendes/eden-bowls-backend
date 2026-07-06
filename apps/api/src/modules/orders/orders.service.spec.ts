import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { OrdersService } from './orders.service';

type PrismaMock = {
  order: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  orderStatusHistory: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

type AuditMock = {
  record: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  order: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  orderStatusHistory: {
    create: jest.fn(),
  },
  $transaction: jest.fn(),
});

const makeAuditMock = (): AuditMock => ({
  record: jest.fn(),
});

describe('OrdersService', () => {
  let prisma: PrismaMock;
  let audit: AuditMock;
  let service: OrdersService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit = makeAuditMock();
    service = new OrdersService(prisma as never, audit as never);
  });

  it('listOrders should return paginated orders for the actor', async () => {
    prisma.order.count.mockResolvedValue(1);
    prisma.order.findMany.mockResolvedValue([{ id: 'order_1' }]);
    prisma.$transaction.mockResolvedValue([[1, [{ id: 'order_1' }]]][0]);

    const output = await service.listOrders(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      {},
    );

    expect(prisma.order.count).toHaveBeenCalledWith({ where: { userId: 'user_1' } });
    expect(output.total).toBe(1);
  });

  it('getOrder should throw when order belongs to another user', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_2',
    });

    await expect(
      service.getOrder(
        { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
        'order_1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('getOrder should return order for owner', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      userId: 'user_1',
      checkoutOrder: { items: [], shippingSelection: [] },
      statusHistory: [],
    });

    const output = await service.getOrder(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'order_1',
    );

    expect(output.id).toBe('order_1');
  });

  it('updateOrderStatus should reject non admin actors', async () => {
    await expect(
      service.updateOrderStatus(
        { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
        'order_1',
        { toStatus: OrderStatus.confirmed },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('updateOrderStatus should update status, create history and audit', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      status: OrderStatus.new,
    });
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        order: {
          update: jest.fn().mockResolvedValue({ id: 'order_1', status: OrderStatus.confirmed }),
        },
        orderStatusHistory: {
          create: jest.fn().mockResolvedValue({ id: 'history_1' }),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.updateOrderStatus(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'order_1',
      { toStatus: OrderStatus.confirmed, reason: 'manual review' },
    );

    expect(output.status).toBe(OrderStatus.confirmed);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'order.status.update',
        resource: 'orders',
        resourceId: 'order_1',
      }),
    );
  });

  it('updateOrderStatus should reject invalid transitions', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order_1',
      status: OrderStatus.delivered,
    });

    await expect(
      service.updateOrderStatus(
        { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
        'order_1',
        { toStatus: OrderStatus.confirmed },
      ),
    ).rejects.toThrow(ConflictException);
  });
});
