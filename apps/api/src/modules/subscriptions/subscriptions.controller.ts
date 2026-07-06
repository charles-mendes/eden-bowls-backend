import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import { SubscriptionActionDto } from './dto/subscription-action.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@Controller('billing/subscriptions')
@UseGuards(JwtAuthGuard)
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Post()
  createSubscription(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateSubscriptionDto,
  ) {
    return this.subscriptionsService.createSubscription(user, idempotencyKey, body);
  }

  @Get()
  listSubscriptions(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSubscriptionsQueryDto,
  ) {
    return this.subscriptionsService.listSubscriptions(user, query);
  }

  @Get(':subscriptionId')
  getSubscription(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId') subscriptionId: string,
  ) {
    return this.subscriptionsService.getSubscription(user, subscriptionId);
  }

  @Patch(':subscriptionId')
  patchSubscription(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: UpdateSubscriptionDto,
  ) {
    return this.subscriptionsService.patchSubscription(user, subscriptionId, body);
  }

  @Post(':subscriptionId/actions')
  executeAction(
    @CurrentUser() user: AuthUser,
    @Param('subscriptionId') subscriptionId: string,
    @Body() body: SubscriptionActionDto,
  ) {
    return this.subscriptionsService.executeAction(user, subscriptionId, body);
  }
}
