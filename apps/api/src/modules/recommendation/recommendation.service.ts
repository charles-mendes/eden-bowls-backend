import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { AuthUser } from '../auth/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { PlanPreviewRequestDto } from './dto/plan-preview-request.dto';
import { PlanSnapshotResponseDto } from './dto/plan-snapshot-response.dto';
import { RecommendationResponseDto } from './dto/recommendation-response.dto';

@Injectable()
export class RecommendationService {
  private readonly recommendationVersion = 'v1.0.0';

  constructor(private readonly prisma: PrismaService) {}

  async getRecommendation(sessionId: string, sessionToken: string | undefined, actor?: AuthUser): Promise<RecommendationResponseDto> {
    const session = await this.getAuthorizedSession(sessionId, sessionToken, actor);
    const run = await this.ensureLatestRun(session.id);

    return this.toRecommendationResponse(session.id, run);
  }

  async getPlanSnapshot(sessionId: string, sessionToken: string | undefined, actor?: AuthUser): Promise<PlanSnapshotResponseDto> {
    const session = await this.getAuthorizedSession(sessionId, sessionToken, actor);
    const run = await this.ensureLatestRun(session.id);
    const snapshot = await this.ensureLatestSnapshot(run.id, session.country, session.id);

    return this.toSnapshotResponse(snapshot);
  }

  async previewPlan(
    sessionId: string,
    sessionToken: string | undefined,
    input: PlanPreviewRequestDto,
    actor?: AuthUser,
  ) {
    const session = await this.getAuthorizedSession(sessionId, sessionToken, actor);
    const run = await this.ensureLatestRun(session.id);
    const snapshot = await this.buildSnapshot(run, session.country, input);

    return {
      recommendation: this.toRecommendationResponse(session.id, run),
      preview: this.toSnapshotResponse(snapshot),
    };
  }

  private async ensureLatestRun(sessionId: string) {
    const existing = await this.prisma.recommendationRun.findFirst({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      include: { petResults: true },
    });

    if (existing) {
      return existing;
    }

    const session = await this.prisma.onboardingSession.findUnique({
      where: { id: sessionId },
      include: {
        sessionPets: {
          orderBy: { sortOrder: 'asc' },
          include: {
            pet: true,
          },
        },
        answers: true,
      },
    });

    if (!session) {
      throw new NotFoundException('onboarding_session_not_found');
    }

    if (session.sessionPets.length === 0) {
      throw new BadRequestException('recommendation_requires_pets');
    }

    const totalDailyGrams = session.sessionPets.reduce((acc, item) => acc + this.computeDailyGrams(item.pet.weightKg, item.pet.activityLevel), 0);
    const petResults = session.sessionPets.map((item) => ({
      petId: item.petId,
      dailyGrams: this.computeDailyGrams(item.pet.weightKg, item.pet.activityLevel),
      monthlyGrams: this.computeDailyGrams(item.pet.weightKg, item.pet.activityLevel) * 30,
      kcalTarget: this.computeKcalTarget(item.pet.weightKg, item.pet.activityLevel),
      factorsJson: {
        weightKg: item.pet.weightKg.toString(),
        activityLevel: item.pet.activityLevel,
        nutritionGoal: item.pet.nutritionGoal,
      },
    }));

    const run = await this.prisma.recommendationRun.create({
      data: {
        sessionId,
        recommendationVersion: this.recommendationVersion,
        marketCountry: session.country,
        currency: this.resolveCurrency(session.country),
        totalDailyGrams: new Prisma.Decimal(totalDailyGrams.toFixed(3)),
        totalMonthlyGrams: new Prisma.Decimal((totalDailyGrams * 30).toFixed(3)),
        petResults: {
          create: petResults.map((item) => ({
            petId: item.petId,
            dailyGrams: new Prisma.Decimal(item.dailyGrams.toFixed(3)),
            monthlyGrams: new Prisma.Decimal(item.monthlyGrams.toFixed(3)),
            kcalTarget: item.kcalTarget,
            factorsJson: item.factorsJson as Prisma.InputJsonValue,
          })),
        },
      },
      include: { petResults: true },
    });

    return run;
  }

  private async ensureLatestSnapshot(runId: string, marketCountry: string, sessionId: string) {
    const existing = await this.prisma.planSnapshot.findFirst({
      where: { runId },
      orderBy: { createdAt: 'desc' },
    });

    if (existing) {
      return existing;
    }

    const run = await this.prisma.recommendationRun.findUnique({
      where: { id: runId },
      include: { petResults: true },
    });

    if (!run) {
      throw new NotFoundException('recommendation_run_not_found');
    }

    return this.buildSnapshot(run, marketCountry, { marketCountry, currency: run.currency }, sessionId);
  }

  private async buildSnapshot(
    run: {
      id: string;
      currency: string;
      totalMonthlyGrams: Prisma.Decimal;
      petResults: Array<{ petId: string; dailyGrams: Prisma.Decimal; monthlyGrams: Prisma.Decimal }>;
    },
    marketCountry: string,
    input: PlanPreviewRequestDto,
    sessionId?: string,
  ) {
    const currency = (input.currency ?? run.currency).toUpperCase();
    const market = (input.marketCountry ?? marketCountry).toUpperCase();

    if (currency.length !== 3) {
      throw new BadRequestException('invalid_currency');
    }

    const subtotalAmount = this.roundMoney(Number(run.totalMonthlyGrams) * this.pricePerGram(market, currency));
    const discountAmount = this.roundMoney(input.discountAmount ?? this.defaultDiscount(subtotalAmount));
    const shippingAmount = input.shippingAmount === undefined ? null : this.roundMoney(input.shippingAmount);
    const totalAmount = this.roundMoney(subtotalAmount - discountAmount + (shippingAmount ?? 0));
    const snapshotHash = this.hashSnapshot({
      runId: run.id,
      market,
      currency,
      subtotalAmount,
      discountAmount,
      shippingAmount,
      totalAmount,
    });

    const payload = {
      sessionId,
      runId: run.id,
      marketCountry: market,
      currency,
      petCount: run.petResults.length,
      subtotalAmount,
      discountAmount,
      shippingAmount,
      totalAmount,
      recommendationVersion: this.recommendationVersion,
    };

    const snapshot = await this.prisma.planSnapshot.create({
      data: {
        runId: run.id,
        snapshotHash,
        subtotalAmount: new Prisma.Decimal(subtotalAmount.toFixed(2)),
        discountAmount: new Prisma.Decimal(discountAmount.toFixed(2)),
        shippingAmount:
          shippingAmount === null ? null : new Prisma.Decimal(shippingAmount.toFixed(2)),
        totalAmount: new Prisma.Decimal(totalAmount.toFixed(2)),
        currency,
        payloadJson: payload as Prisma.InputJsonValue,
      },
    });

    return snapshot;
  }

  private toRecommendationResponse(sessionId: string, run: { id: string; recommendationVersion: string; marketCountry: string; currency: string; totalDailyGrams: Prisma.Decimal; totalMonthlyGrams: Prisma.Decimal; petResults: Array<{ petId: string; dailyGrams: Prisma.Decimal; monthlyGrams: Prisma.Decimal; kcalTarget: number | null; factorsJson: Prisma.JsonValue | null; }>; }): RecommendationResponseDto {
    return {
      sessionId,
      recommendationVersion: run.recommendationVersion,
      marketCountry: run.marketCountry,
      currency: run.currency,
      totalDailyGrams: Number(run.totalDailyGrams),
      totalMonthlyGrams: Number(run.totalMonthlyGrams),
      petResults: run.petResults.map((item) => ({
        petId: item.petId,
        dailyGrams: Number(item.dailyGrams),
        monthlyGrams: Number(item.monthlyGrams),
        kcalTarget: item.kcalTarget,
        factors: (item.factorsJson ?? {}) as Record<string, unknown>,
      })),
    };
  }

  private toSnapshotResponse(snapshot: { id: string; snapshotHash: string; runId: string; subtotalAmount: Prisma.Decimal; discountAmount: Prisma.Decimal; shippingAmount: Prisma.Decimal | null; totalAmount: Prisma.Decimal; currency: string; }): PlanSnapshotResponseDto {
    return {
      snapshotId: snapshot.id,
      snapshotHash: snapshot.snapshotHash,
      recommendationRunId: snapshot.runId,
      subtotalAmount: Number(snapshot.subtotalAmount),
      discountAmount: Number(snapshot.discountAmount),
      shippingAmount: snapshot.shippingAmount === null ? null : Number(snapshot.shippingAmount),
      totalAmount: Number(snapshot.totalAmount),
      currency: snapshot.currency,
    };
  }

  private computeDailyGrams(weightKg: Prisma.Decimal, activityLevel: string) {
    const weight = Number(weightKg);
    const factor = this.activityFactor(activityLevel);
    return this.roundMoney(weight * factor);
  }

  private computeKcalTarget(weightKg: Prisma.Decimal, activityLevel: string) {
    const dailyGrams = this.computeDailyGrams(weightKg, activityLevel);
    return Math.round(dailyGrams * 3.2);
  }

  private activityFactor(activityLevel: string) {
    const normalized = activityLevel.toLowerCase();

    if (normalized.includes('high') || normalized.includes('active')) {
      return 14;
    }

    if (normalized.includes('low') || normalized.includes('sedent')) {
      return 10;
    }

    return 12;
  }

  private resolveCurrency(country: string) {
    return country === 'BR' ? 'BRL' : 'USD';
  }

  private pricePerGram(marketCountry: string, currency: string) {
    if (marketCountry === 'BR' || currency === 'BRL') {
      return 0.12;
    }

    return 0.1;
  }

  private defaultDiscount(subtotalAmount: number) {
    return this.roundMoney(subtotalAmount > 300 ? subtotalAmount * 0.05 : 0);
  }

  private roundMoney(value: number) {
    return Math.round(value * 1000) / 1000;
  }

  private hashSnapshot(input: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private async getAuthorizedSession(sessionId: string, sessionToken: string | undefined, actor?: AuthUser) {
    const session = await this.prisma.onboardingSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        linkedUserId: true,
        tokenHash: true,
        expiresAt: true,
        country: true,
      },
    });

    if (!session) {
      throw new NotFoundException('onboarding_session_not_found');
    }

    if (session.linkedUserId && actor && actor.userId === session.linkedUserId) {
      return session;
    }

    if (!sessionToken) {
      throw new ForbiddenException('session_token_required');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('session_token_expired');
    }

    const isValid = createHash('sha256').update(sessionToken).digest('hex') === session.tokenHash;
    if (!isValid) {
      throw new ForbiddenException('invalid_session_token');
    }

    return session;
  }
}
