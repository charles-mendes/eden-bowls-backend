import { OrderStatus } from '@prisma/client';

import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let service: {
    listOrders: jest.Mock;
    getOrder: jest.Mock;
    updateOrderStatus: jest.Mock;
  };
  let controller: OrdersController;

  beforeEach(() => {
    service = {
      listOrders: jest.fn(),
      getOrder: jest.fn(),
      updateOrderStatus: jest.fn(),
    };
    controller = new OrdersController(service as unknown as OrdersService);
  });

  it('listOrders should delegate to OrdersService.listOrders', async () => {
    service.listOrders.mockResolvedValue({ total: 1, page: 1, perPage: 20, items: [{ id: 'order_1' }] });

    const output = await controller.listOrders(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      {},
    );

    expect(service.listOrders).toHaveBeenCalled();
    expect(output.total).toBe(1);
  });

  it('getOrder should delegate to OrdersService.getOrder', async () => {
    service.getOrder.mockResolvedValue({ id: 'order_1' });

    const output = await controller.getOrder(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'order_1',
    );

    expect(service.getOrder).toHaveBeenCalledWith(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'order_1',
    );
    expect(output).toEqual({ id: 'order_1' });
  });

  it('updateOrderStatus should delegate to OrdersService.updateOrderStatus', async () => {
    service.updateOrderStatus.mockResolvedValue({ id: 'order_1', status: OrderStatus.confirmed });

    const output = await controller.updateOrderStatus(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'order_1',
      { toStatus: OrderStatus.confirmed, reason: 'manual review' },
    );

    expect(service.updateOrderStatus).toHaveBeenCalledWith(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'order_1',
      { toStatus: OrderStatus.confirmed, reason: 'manual review' },
    );
    expect(output).toEqual({ id: 'order_1', status: OrderStatus.confirmed });
  });
});
