import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CatalogSyncDto } from './dto/catalog-sync.dto';
import { CatalogSyncHealthQueryDto } from './dto/catalog-sync-health-query.dto';
import { CatalogSyncStatusQueryDto } from './dto/catalog-sync-status-query.dto';
import { StripePriceQueryDto } from './dto/stripe-price-query.dto';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';
import { PaymentsService } from './payments.service';

@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('billing/catalog/sync')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  syncCatalog(@Body() body: CatalogSyncDto) {
    return this.paymentsService.syncCatalog(body);
  }

  @Post('billing/catalog/sync/:productId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  syncCatalogProduct(@Param('productId') productId: string) {
    return this.paymentsService.syncCatalogProduct(productId);
  }

  @Get('billing/catalog/sync/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  getSyncStatus(@Query() query: CatalogSyncStatusQueryDto) {
    return this.paymentsService.getSyncStatus(query);
  }

  @Get('billing/catalog/sync/health')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  getSyncHealth(@Query() query: CatalogSyncHealthQueryDto) {
    return this.paymentsService.getSyncHealth(query);
  }

  @Get('billing/products/:productId/variants/:variantId/stripe-price')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  getStripePriceMap(
    @Param('productId') productId: string,
    @Param('variantId') variantId: string,
    @Query() query: StripePriceQueryDto,
  ) {
    return this.paymentsService.getStripePriceMap(productId, variantId, query);
  }

  @Post('billing/webhooks/stripe')
  receiveStripeWebhook(
    @Body() body: StripeWebhookDto,
    @Headers('stripe-signature') stripeSignature: string | undefined,
  ) {
    return this.paymentsService.receiveStripeWebhook(body, stripeSignature);
  }
}
