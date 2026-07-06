import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthUser } from '../auth/types/auth-user.type';
import { AddSessionPetDto } from './dto/add-session-pet.dto';
import { SavePlanSelectionDto } from './dto/save-plan-selection.dto';
import { SaveQuestionnaireDto } from './dto/save-questionnaire.dto';
import { SaveRecurrenceDto } from './dto/save-recurrence.dto';
import { SaveZipcodeDto } from './dto/save-zipcode.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { UpdateSessionPetDto } from './dto/update-session-pet.dto';
import { OnboardingService } from './onboarding.service';

@Controller('onboarding/sessions')
export class OnboardingController {
  constructor(private readonly onboardingService: OnboardingService) {}

  @Post()
  startSession(@Body() body: StartSessionDto) {
    return this.onboardingService.startSession(body);
  }

  @Get(':sessionId')
  getSession(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.getSession(sessionId, sessionToken, user);
  }

  @Post(':sessionId/token/refresh')
  refreshSessionToken(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.refreshToken(sessionId, sessionToken, user);
  }

  @Post(':sessionId/pets')
  addSessionPet(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: AddSessionPetDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.addSessionPet(sessionId, sessionToken, body, user);
  }

  @Patch(':sessionId/pets/:petId')
  updateSessionPet(
    @Param('sessionId') sessionId: string,
    @Param('petId') petId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: UpdateSessionPetDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.updateSessionPet(
      sessionId,
      petId,
      sessionToken,
      body,
      user,
    );
  }

  @Delete(':sessionId/pets/:petId')
  removeSessionPet(
    @Param('sessionId') sessionId: string,
    @Param('petId') petId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.removeSessionPet(
      sessionId,
      petId,
      sessionToken,
      user,
    );
  }

  @Post(':sessionId/questionnaire')
  saveQuestionnaire(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: SaveQuestionnaireDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.saveQuestionnaire(sessionId, sessionToken, body, user);
  }

  @Post(':sessionId/recurrence')
  saveRecurrence(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: SaveRecurrenceDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.saveRecurrence(sessionId, sessionToken, body, user);
  }

  @Post(':sessionId/plan-selection')
  savePlanSelection(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: SavePlanSelectionDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.savePlanSelection(sessionId, sessionToken, body, user);
  }

  @Post(':sessionId/zipcode')
  saveZipcode(
    @Param('sessionId') sessionId: string,
    @Headers('x-onboarding-token') sessionToken: string | undefined,
    @Body() body: SaveZipcodeDto,
    @CurrentUser() user: AuthUser | undefined,
  ) {
    return this.onboardingService.saveZipcode(sessionId, sessionToken, body, user);
  }

  @Post(':sessionId/account-link')
  @UseGuards(JwtAuthGuard)
  linkSessionToAccount(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.onboardingService.linkSessionToAccount(sessionId, user);
  }
}
