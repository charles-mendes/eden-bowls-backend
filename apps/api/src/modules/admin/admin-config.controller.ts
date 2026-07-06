import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminBusinessRulesQueryDto } from './dto/admin-business-rules-query.dto';
import { UpdateBusinessRuleDto } from './dto/update-business-rule.dto';
import { AdminConfigService } from './admin-config.service';

@Controller('admin/config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminConfigController {
  constructor(private readonly adminConfigService: AdminConfigService) {}

  @Get('business-rules')
  @Roles('admin', 'operator', 'readonly')
  listBusinessRules(@Query() query: AdminBusinessRulesQueryDto) {
    return this.adminConfigService.listBusinessRules(query);
  }

  @Put('business-rules/:id')
  @Roles('admin', 'operator')
  updateBusinessRule(@Param('id') id: string, @Body() body: UpdateBusinessRuleDto) {
    return this.adminConfigService.updateBusinessRule(id, body);
  }
}