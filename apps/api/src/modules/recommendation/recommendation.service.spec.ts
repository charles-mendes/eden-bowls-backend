import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { RecommendationService } from './recommendation.service';

type PrismaMock = {
  onboardingSession: {
    findUnique: jest.Mock;
  };
  recommendationRun: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
  };
  planSnapshot: {
    findFirst: jest.Mock;
    create: jest.Mock;
  };
};

const makePrismaMock = (): PrismaMock => ({
  onboardingSession: {
    findUnique: jest.fn(),
  },
  recommendationRun: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  planSnapshot: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
});

const makeSession = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'session_1',
  linkedUserId: null,
  tokenHash: createHash('sha256').update('session-token').digest('hex'),
  expiresAt: new Date('2026-12-31T00:00:00.000Z'),
  country: 'BR',
  ...overrides,
});

describe('RecommendationService', () => {
  let prisma: PrismaMock;
  let service: RecommendationService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new RecommendationService(prisma as never);
  });

  it('getRecommendation should reject when session token is missing', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());

    await expect(service.getRecommendation('session_1', undefined)).rejects.toThrow(ForbiddenException);
  });

  it('getRecommendation should return an existing run', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.recommendationRun.findFirst.mockResolvedValue({
      id: 'run_1',
      recommendationVersion: 'v1.0.0',
      marketCountry: 'BR',
      currency: 'BRL',
      totalDailyGrams: new Prisma.Decimal('123.45'),
      totalMonthlyGrams: new Prisma.Decimal('3703.5'),
      petResults: [
        {
          petId: 'pet_1',
          dailyGrams: new Prisma.Decimal('12.3'),
          monthlyGrams: new Prisma.Decimal('369'),
          kcalTarget: 41,
          factorsJson: { weightKg: '10' },
        },
      ],
    });

    const output = await service.getRecommendation('session_1', 'session-token');

    expect(output.sessionId).toBe('session_1');
    expect(output.petResults[0].petId).toBe('pet_1');
    expect(prisma.recommendationRun.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sessionId: 'session_1' },
      }),
    );
  });

  it('getRecommendation should create a run when none exists', async () => {
    prisma.onboardingSession.findUnique
      .mockResolvedValueOnce(makeSession())
      .mockResolvedValueOnce({
        id: 'session_1',
        country: 'BR',
        sessionPets: [
          {
            petId: 'pet_1',
            pet: {
              weightKg: new Prisma.Decimal('10'),
              activityLevel: 'moderate',
              nutritionGoal: 'maintenance',
            },
          },
        ],
        answers: [],
      });
    prisma.recommendationRun.findFirst.mockResolvedValue(null);
    prisma.recommendationRun.create.mockResolvedValue({
      id: 'run_1',
      recommendationVersion: 'v1.0.0',
      marketCountry: 'BR',
      currency: 'BRL',
      totalDailyGrams: new Prisma.Decimal('120'),
      totalMonthlyGrams: new Prisma.Decimal('3600'),
      petResults: [
        {
          petId: 'pet_1',
          dailyGrams: new Prisma.Decimal('120'),
          monthlyGrams: new Prisma.Decimal('3600'),
          kcalTarget: 384,
          factorsJson: { weightKg: '10', activityLevel: 'moderate', nutritionGoal: 'maintenance' },
        },
      ],
    });

    const output = await service.getRecommendation('session_1', 'session-token');

    expect(output.recommendationVersion).toBe('v1.0.0');
    expect(prisma.recommendationRun.create).toHaveBeenCalled();
  });

  it('getPlanSnapshot should create a snapshot when missing', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.recommendationRun.findFirst.mockResolvedValue({
      id: 'run_1',
      recommendationVersion: 'v1.0.0',
      marketCountry: 'BR',
      currency: 'BRL',
      totalDailyGrams: new Prisma.Decimal('120'),
      totalMonthlyGrams: new Prisma.Decimal('3600'),
      petResults: [
        { petId: 'pet_1', dailyGrams: new Prisma.Decimal('120'), monthlyGrams: new Prisma.Decimal('3600'), kcalTarget: 384, factorsJson: {} },
      ],
    });
    prisma.planSnapshot.findFirst.mockResolvedValue(null);
    prisma.recommendationRun.findUnique.mockResolvedValue({
      id: 'run_1',
      currency: 'BRL',
      petResults: [{ petId: 'pet_1', dailyGrams: new Prisma.Decimal('120'), monthlyGrams: new Prisma.Decimal('3600') }],
    });
    prisma.planSnapshot.create.mockResolvedValue({
      id: 'snapshot_1',
      snapshotHash: 'hash_1',
      runId: 'run_1',
      subtotalAmount: new Prisma.Decimal('100'),
      discountAmount: new Prisma.Decimal('0'),
      shippingAmount: null,
      totalAmount: new Prisma.Decimal('100'),
      currency: 'BRL',
    });

    const output = await service.getPlanSnapshot('session_1', 'session-token');

    expect(output.snapshotId).toBe('snapshot_1');
    expect(prisma.planSnapshot.create).toHaveBeenCalled();
  });

  it('previewPlan should return recommendation and preview', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(makeSession());
    prisma.recommendationRun.findFirst.mockResolvedValue({
      id: 'run_1',
      recommendationVersion: 'v1.0.0',
      marketCountry: 'BR',
      currency: 'BRL',
      totalDailyGrams: new Prisma.Decimal('120'),
      totalMonthlyGrams: new Prisma.Decimal('3600'),
      petResults: [
        { petId: 'pet_1', dailyGrams: new Prisma.Decimal('120'), monthlyGrams: new Prisma.Decimal('3600'), kcalTarget: 384, factorsJson: {} },
      ],
    });
    prisma.planSnapshot.create.mockResolvedValue({
      id: 'snapshot_1',
      snapshotHash: 'hash_1',
      runId: 'run_1',
      subtotalAmount: new Prisma.Decimal('100'),
      discountAmount: new Prisma.Decimal('10'),
      shippingAmount: new Prisma.Decimal('15'),
      totalAmount: new Prisma.Decimal('105'),
      currency: 'BRL',
    });

    const output = await service.previewPlan(
      'session_1',
      'session-token',
      { marketCountry: 'BR', currency: 'BRL', shippingAmount: 15, discountAmount: 10 },
    );

    expect(output.recommendation.sessionId).toBe('session_1');
    expect(output.preview.snapshotId).toBe('snapshot_1');
  });

  it('getPlanSnapshot should reject missing sessions', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(null);

    await expect(service.getPlanSnapshot('missing', 'session-token')).rejects.toThrow(NotFoundException);
  });
});
