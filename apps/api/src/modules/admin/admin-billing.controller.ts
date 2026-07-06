import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminSubscriptionsQueryDto } from '../payments/dto/admin-subscriptions-query.dto';
import { AdminWebhooksQueryDto } from '../payments/dto/admin-webhooks-query.dto';
import { AdminBillingService } from './admin-billing.service';

@Controller('admin/billing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operator', 'readonly')
export class AdminBillingController {
  constructor(private readonly adminBillingService: AdminBillingService) {}

  @Get('webhooks')
  listWebhookEvents(@Query() query: AdminWebhooksQueryDto) {
    return this.adminBillingService.listWebhookEvents(query);
  }

  @Get('subscriptions')
  listSubscriptions(@Query() query: AdminSubscriptionsQueryDto) {
    return this.adminBillingService.listSubscriptions(query);
  }
}