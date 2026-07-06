import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { AuthUser } from '../auth/types/auth-user.type';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listOrders(actor: AuthUser, query: ListOrdersQueryDto) {
    return this.listOrdersByWhere(
      {
        userId: actor.userId,
      },
      query,
    );
  }

  async listAdminOrders(query: ListOrdersQueryDto) {
    return this.listOrdersByWhere({}, query, true);
  }

  async getAdminOrder(orderId: string) {
    return this.getOrderById(orderId, true);
  }

  private async listOrdersByWhere(
    baseWhere: Prisma.OrderWhereInput,
    query: ListOrdersQueryDto,
    includeUser = false,
  ) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.OrderWhereInput = {
      ...baseWhere,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          ...(includeUser
            ? {
                user: {
                  select: {
                    id: true,
                    email: true,
                  },
                },
              }
            : {}),
          checkoutOrder: {
            include: {
              items: true,
              shippingSelection: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      perPage,
      items,
    };
  }

  async getOrder(actor: AuthUser, orderId: string) {
    const order = await this.getOrderById(orderId);

    if (order.userId !== actor.userId && !this.isAdmin(actor)) {
      throw new ForbiddenException('forbidden');
    }

    return order;
  }

  private async getOrderById(orderId: string, includeUser = false) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        ...(includeUser
          ? {
              user: {
                select: {
                  id: true,
                  email: true,
                },
              },
            }
          : {}),
        checkoutOrder: {
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    slug: true,
                    namePt: true,
                    nameEn: true,
                  },
                },
                variant: {
                  select: {
                    id: true,
                    sku: true,
                    flavorKey: true,
                    weightLabel: true,
                  },
                },
              },
            },
            shippingSelection: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    return order;
  }

  async updateOrderStatus(
    actor: AuthUser,
    orderId: string,
    input: UpdateOrderStatusDto,
  ) {
    if (!this.isAdmin(actor)) {
      throw new ForbiddenException('forbidden');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
      },
    });

    if (!order) {
      throw new NotFoundException('order_not_found');
    }

    if (!this.canTransition(order.status, input.toStatus)) {
      throw new ConflictException('invalid_order_transition');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: input.toStatus,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: order.status,
          toStatus: input.toStatus,
          reason: input.reason,
          changedByUserId: actor.userId,
        },
      });

      await this.auditService.record({
        actorUserId: actor.userId,
        actorRole: actor.roles?.[0],
        action: 'order.status.update',
        resource: 'orders',
        resourceId: order.id,
        beforeJson: order as Prisma.InputJsonValue,
        afterJson: updated as Prisma.InputJsonValue,
      });

      return updated;
    });
  }

  private canTransition(from: OrderStatus, to: OrderStatus) {
    if (from === to) {
      return true;
    }

    const map: Record<OrderStatus, OrderStatus[]> = {
      new: ['confirmed', 'cancelled'],
      confirmed: ['preparing', 'cancelled'],
      preparing: ['shipped', 'cancelled'],
      shipped: ['delivered'],
      delivered: [],
      cancelled: [],
    };

    return map[from].includes(to);
  }

  private isAdmin(actor: AuthUser) {
    return actor.roles.some((role) => ['admin', 'operator'].includes(role));
  }
}
