import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('orders')
  listOrders(@CurrentUser() user: AuthUser, @Query() query: ListOrdersQueryDto) {
    return this.ordersService.listOrders(user, query);
  }

  @Get('admin/orders')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  listAdminOrders(@Query() query: ListOrdersQueryDto) {
    return this.ordersService.listAdminOrders(query);
  }

  @Get('admin/orders/:orderId')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  getAdminOrder(@Param('orderId') orderId: string) {
    return this.ordersService.getAdminOrder(orderId);
  }

  @Get('orders/:orderId')
  getOrder(@CurrentUser() user: AuthUser, @Param('orderId') orderId: string) {
    return this.ordersService.getOrder(user, orderId);
  }

  @Patch('admin/orders/:orderId/status')
  @UseGuards(RolesGuard)
  @Roles('admin', 'operator')
  updateOrderStatus(
    @CurrentUser() user: AuthUser,
    @Param('orderId') orderId: string,
    @Body() body: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(user, orderId, body);
  }
}
