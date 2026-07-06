import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthUser } from '../auth/types/auth-user.type';
import { PlanPreviewRequestDto } from './dto/plan-preview-request.dto';
import { RecommendationService } from './recommendation.service';

@Controller('onboarding/sessions/:sessionId')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('recommendation')
  getRecommendation(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.recommendationService.getRecommendation(sessionId, sessionToken, user);
  }

  @Get('plan/snapshot')
  getPlanSnapshot(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.recommendationService.getPlanSnapshot(sessionId, sessionToken, user);
  }

  @Post('plan/preview')
  previewPlan(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: PlanPreviewRequestDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.recommendationService.previewPlan(sessionId, sessionToken, body, user);
  }
}
