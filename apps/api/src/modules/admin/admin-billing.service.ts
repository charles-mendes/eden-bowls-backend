import { Injectable } from '@nestjs/common';

import { AdminSubscriptionsQueryDto } from '../payments/dto/admin-subscriptions-query.dto';
import { AdminWebhooksQueryDto } from '../payments/dto/admin-webhooks-query.dto';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class AdminBillingService {
  constructor(private readonly paymentsService: PaymentsService) {}

  listWebhookEvents(query: AdminWebhooksQueryDto) {
    return this.paymentsService.listWebhookEvents(query);
  }

  listSubscriptions(query: AdminSubscriptionsQueryDto) {
    return this.paymentsService.listAdminSubscriptions(query);
  }
}