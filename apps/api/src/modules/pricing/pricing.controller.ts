import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminListPricingQueryDto } from './dto/admin-list-pricing-query.dto';
import { AdminUpsertPriceDto } from './dto/admin-upsert-price.dto';
import { CalculatePlanDto } from './dto/calculate-plan.dto';
import { PricingService } from './pricing.service';

@Controller()
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Post('catalog/plans/calculate')
  calculatePlan(@Body() body: CalculatePlanDto) {
    return this.pricingService.calculatePlan(body);
  }

  @Get('admin/catalog/pricing')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  adminListPricing(@Query() query: AdminListPricingQueryDto) {
    return this.pricingService.adminListPricing(query);
  }

  @Post('admin/catalog/pricing')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  adminCreatePricing(@Body() body: AdminUpsertPriceDto) {
    return this.pricingService.adminCreatePricing(body);
  }
}
