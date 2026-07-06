import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnboardingStatus, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';

import { AuthUser } from '../auth/types/auth-user.type';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AddSessionPetDto } from './dto/add-session-pet.dto';
import { SavePlanSelectionDto } from './dto/save-plan-selection.dto';
import { SaveQuestionnaireDto } from './dto/save-questionnaire.dto';
import { SaveRecurrenceDto } from './dto/save-recurrence.dto';
import { SaveZipcodeDto } from './dto/save-zipcode.dto';
import { StartSessionDto } from './dto/start-session.dto';
import { UpdateSessionPetDto } from './dto/update-session-pet.dto';

@Injectable()
export class OnboardingService {
  private readonly tokenTtlMinutes = 60 * 24;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async startSession(input: StartSessionDto) {
    const sessionToken = this.generateToken();
    const tokenHash = this.hashToken(sessionToken);

    const session = await this.prisma.onboardingSession.create({
      data: {
        status: OnboardingStatus.started,
        locale: (input.locale ?? 'pt-BR').trim(),
        country: input.country.toUpperCase(),
        state: input.state,
        tokenHash,
        expiresAt: this.newExpiry(),
      },
      select: {
        id: true,
        status: true,
        locale: true,
        country: true,
        state: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    return {
      ...session,
      sessionToken,
    };
  }

  async getSession(sessionId: string, sessionToken: string | undefined, actor?: AuthUser) {
    const session = await this.getSessionOrFail(sessionId);
    this.assertSessionAccess(session, sessionToken, actor);

    const [pets, answers] = await this.prisma.$transaction([
      this.prisma.onboardingSessionPet.findMany({
        where: { sessionId },
        orderBy: { sortOrder: 'asc' },
        include: {
          pet: {
            select: {
              id: true,
              userId: true,
              name: true,
              species: true,
              weightKg: true,
              activityLevel: true,
              deletedAt: true,
            },
          },
        },
      }),
      this.prisma.onboardingAnswer.findMany({
        where: { sessionId },
        orderBy: { updatedAt: 'asc' },
      }),
    ]);

    return {
      id: session.id,
      status: session.status,
      linkedUserId: session.linkedUserId,
      locale: session.locale,
      country: session.country,
      state: session.state,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      pets,
      answers,
    };
  }

  async refreshToken(sessionId: string, sessionToken: string | undefined, actor?: AuthUser) {
    const session = await this.getSessionOrFail(sessionId);
    this.assertSessionAccess(session, sessionToken, actor);

    const nextToken = this.generateToken();

    const updated = await this.prisma.onboardingSession.update({
      where: { id: sessionId },
      data: {
        tokenHash: this.hashToken(nextToken),
        expiresAt: this.newExpiry(),
      },
      select: {
        id: true,
        status: true,
        expiresAt: true,
        updatedAt: true,
      },
    });

    return {
      ...updated,
      sessionToken: nextToken,
    };
  }

  async addSessionPet(
    sessionId: string,
    sessionToken: string | undefined,
    input: AddSessionPetDto,
    actor?: AuthUser,
  ) {
    const session = await this.getSessionOrFail(sessionId);
    this.assertSessionAccess(session, sessionToken, actor);

    const pet = await this.prisma.pet.findFirst({
      where: {
        id: input.petId,
        deletedAt: null,
      },
      select: {
        id: true,
        userId: true,
      },
    });

    if (!pet) {
      throw new NotFoundException('pet_not_found');
    }

    if (session.linkedUserId && pet.userId !== session.linkedUserId) {
      throw new ForbiddenException('pet_not_allowed_for_session');
    }

    const maxSort = await this.prisma.onboardingSessionPet.aggregate({
      where: { sessionId },
      _max: { sortOrder: true },
    });

    const sortOrder = input.sortOrder ?? (maxSort._max.sortOrder ?? 0) + 1;

    const relation = await this.prisma.onboardingSessionPet.upsert({
      where: {
        sessionId_petId: {
          sessionId,
          petId: input.petId,
        },
      },
      update: { sortOrder },
      create: {
        sessionId,
        petId: input.petId,
        sortOrder,
      },
    });

    await this.markInProgress(sessionId, session.status);
    await this.auditService.record({
      actorUserId: actor?.userId,
      actorRole: actor?.roles?.[0],
      action: 'onboarding.session_pet.upsert',
      resource: 'onboarding_session_pets',
      resourceId: relation.id,
      afterJson: relation as Prisma.InputJsonValue,
    });

    return relation;
  }

  async updateSessionPet(
    sessionId: string,
    petId: string,
    sessionToken: string | undefined,
    input: UpdateSessionPetDto,
    actor?: AuthUser,
  ) {
    const session = await this.getSessionOrFail(sessionId);
    this.assertSessionAccess(session, sessionToken, actor);

    const relation = await this.prisma.onboardingSessionPet.findUnique({
      where: {
        sessionId_petId: {
          sessionId,
          petId,
        },
      },
      select: { id: true },
    });

    if (!relation) {
      throw new NotFoundException('session_pet_not_found');
    }

    const updated = await this.prisma.onboardingSessionPet.update({
      where: { id: relation.id },
      data: {
        sortOrder: input.sortOrder,
      },
    });

    await this.markInProgress(sessionId, session.status);
    await this.auditService.record({
      actorUserId: actor?.userId,
      actorRole: actor?.roles?.[0],
      action: 'onboarding.session_pet.update',
      resource: 'onboarding_session_pets',
      resourceId: updated.id,
      afterJson: updated as Prisma.InputJsonValue,
    });

    return updated;
  }

  async removeSessionPet(
    sessionId: string,
    petId: string,
    sessionToken: string | undefined,
    actor?: AuthUser,
  ) {
    const session = await this.getSessionOrFail(sessionId);
    this.assertSessionAccess(session, sessionToken, actor);

    const removed = await this.prisma.onboardingSessionPet.deleteMany({
      where: {
        sessionId,
        petId,
      },
    });

    if (removed.count === 0) {
      throw new NotFoundException('session_pet_not_found');
    }

    await this.markInProgress(sessionId, session.status);
    await this.auditService.record({
      actorUserId: actor?.userId,
      actorRole: actor?.roles?.[0],
      action: 'onboarding.session_pet.delete',
      resource: 'onboarding_session_pets',
      resourceId: `${sessionId}:${petId}`,
      afterJson: { removed: true },
    });

    return { success: true };
  }

  saveQuestionnaire(
    sessionId: string,
    sessionToken: string | undefined,
    input: SaveQuestionnaireDto,
    actor?: AuthUser,
  ) {
    return this.saveStepAnswer(sessionId, sessionToken, 'questionnaire', input.answers, actor);
  }

  saveRecurrence(
    sessionId: string,
    sessionToken: string | undefined,
    input: SaveRecurrenceDto,
    actor?: AuthUser,
  ) {
    return this.saveStepAnswer(sessionId, sessionToken, 'recurrence', input.recurrence, actor);
  }

  savePlanSelection(
    sessionId: string,
    sessionToken: string | undefined,
    input: SavePlanSelectionDto,
    actor?: AuthUser,
  ) {
    return this.saveStepAnswer(sessionId, sessionToken, 'plan_selection', input.selection, actor);
  }

  saveZipcode(
    sessionId: string,
    sessionToken: string | undefined,
    input: SaveZipcodeDto,
    actor?: AuthUser,
  ) {
    return this.saveStepAnswer(
      sessionId,
      sessionToken,
      'zipcode',
      {
        postcode: input.postcode,
        country: input.country,
      },
      actor,
    );
  }

  async linkSessionToAccount(sessionId: string, actor: AuthUser) {
    const session = await this.getSessionOrFail(sessionId);

    const updated = await this.prisma.onboardingSession.update({
      where: { id: session.id },
      data: {
        linkedUserId: actor.userId,
      },
      select: {
        id: true,
        linkedUserId: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorUserId: actor.userId,
      actorRole: actor.roles?.[0],
      action: 'onboarding.account_link',
      resource: 'onboarding_sessions',
      resourceId: updated.id,
      beforeJson: session as Prisma.InputJsonValue,
      afterJson: updated as Prisma.InputJsonValue,
    });

    await this.prisma.onboardingSessionPet.deleteMany({
      where: {
        sessionId,
        pet: {
          userId: { not: actor.userId },
        },
      },
    });

    return updated;
  }

  private async saveStepAnswer(
    sessionId: string,
    sessionToken: string | undefined,
    stepKey: string,
    payload: Record<string, unknown>,
    actor?: AuthUser,
  ) {
    const session = await this.getSessionOrFail(sessionId);
    this.assertSessionAccess(session, sessionToken, actor);

    const answer = await this.prisma.onboardingAnswer.upsert({
      where: {
        sessionId_stepKey: {
          sessionId,
          stepKey,
        },
      },
      update: {
        answerJson: payload as Prisma.InputJsonValue,
      },
      create: {
        sessionId,
        stepKey,
        answerJson: payload as Prisma.InputJsonValue,
      },
    });

    await this.markInProgress(sessionId, session.status);
    await this.auditService.record({
      actorUserId: actor?.userId,
      actorRole: actor?.roles?.[0],
      action: `onboarding.${stepKey}.save`,
      resource: 'onboarding_answers',
      resourceId: answer.id,
      afterJson: answer as Prisma.InputJsonValue,
    });

    return answer;
  }

  private async getSessionOrFail(sessionId: string) {
    const session = await this.prisma.onboardingSession.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException('onboarding_session_not_found');
    }

    return session;
  }

  private assertSessionAccess(
    session: {
      id: string;
      linkedUserId: string | null;
      tokenHash: string;
      expiresAt: Date;
    },
    sessionToken: string | undefined,
    actor?: AuthUser,
  ) {
    if (session.linkedUserId && actor && actor.userId === session.linkedUserId) {
      return;
    }

    if (!sessionToken) {
      throw new ForbiddenException('session_token_required');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('session_token_expired');
    }

    const isValid = this.hashToken(sessionToken) === session.tokenHash;
    if (!isValid) {
      throw new ForbiddenException('invalid_session_token');
    }
  }

  private async markInProgress(sessionId: string, currentStatus: OnboardingStatus) {
    if (currentStatus === OnboardingStatus.started) {
      await this.prisma.onboardingSession.update({
        where: { id: sessionId },
        data: { status: OnboardingStatus.in_progress },
      });
    }
  }

  private newExpiry() {
    return new Date(Date.now() + this.tokenTtlMinutes * 60 * 1000);
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private generateToken() {
    return randomBytes(32).toString('hex');
  }
}
