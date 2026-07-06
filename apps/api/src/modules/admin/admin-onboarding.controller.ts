import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminOnboardingService } from './admin-onboarding.service';
import { AdminListQueryDto } from './dto/admin-list-query.dto';

@Controller('admin/onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operator', 'readonly')
export class AdminOnboardingController {
  constructor(private readonly adminOnboardingService: AdminOnboardingService) {}

  @Get('sessions')
  listSessions(@Query() query: AdminListQueryDto) {
    return this.adminOnboardingService.listSessions(query);
  }

  @Get('sessions/:id')
  getSession360(@Param('id') id: string) {
    return this.adminOnboardingService.getSession360(id);
  }

  @Get('metrics')
  getMetrics() {
    return this.adminOnboardingService.getMetrics();
  }
}