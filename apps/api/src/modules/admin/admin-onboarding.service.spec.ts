import { NotFoundException } from '@nestjs/common';
import { OnboardingStatus } from '@prisma/client';

import { AdminOnboardingService } from './admin-onboarding.service';

type PrismaMock = {
  onboardingSession: {
    count: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    groupBy: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  onboardingSession: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    groupBy: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('AdminOnboardingService', () => {
  let prisma: PrismaMock;
  let service: AdminOnboardingService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new AdminOnboardingService(prisma as never);
  });

  it('listSessions should return paginated sessions', async () => {
    prisma.$transaction.mockResolvedValue([
      1,
      [{ id: 'session_1' }],
    ]);

    const output = await service.listSessions({ page: 1, perPage: 20 });

    expect(prisma.onboardingSession.count).toHaveBeenCalledWith();
    expect(prisma.onboardingSession.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 0,
        take: 20,
      }),
    );
    expect(output).toEqual({
      total: 1,
      page: 1,
      perPage: 20,
      totalPages: 1,
      items: [{ id: 'session_1' }],
    });
  });

  it('getSession360 should return detailed session', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue({ id: 'session_1', sessionPets: [] });

    const output = await service.getSession360('session_1');

    expect(prisma.onboardingSession.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session_1' },
      }),
    );
    expect(output).toEqual({ id: 'session_1', sessionPets: [] });
  });

  it('getSession360 should throw when session does not exist', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(null);

    await expect(service.getSession360('missing')).rejects.toThrow(NotFoundException);
  });

  it('getMetrics should aggregate status counts and expiring sessions', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    jest.spyOn(Date, 'now').mockReturnValue(now.getTime());
    jest.useFakeTimers().setSystemTime(now);

    prisma.onboardingSession.groupBy.mockResolvedValue([
      { status: OnboardingStatus.started, _count: { _all: 3 } },
      { status: OnboardingStatus.completed, _count: { _all: 2 } },
    ]);
    prisma.onboardingSession.count.mockResolvedValue(4);

    const output = await service.getMetrics();

    expect(prisma.onboardingSession.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      _count: { _all: true },
    });
    expect(prisma.onboardingSession.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [OnboardingStatus.started, OnboardingStatus.in_progress] },
        }),
      }),
    );
    expect(output.totalSessions).toBe(5);
    expect(output.byStatus.started).toBe(3);
    expect(output.byStatus.completed).toBe(2);
    expect(output.expiringIn24h).toBe(4);

    jest.useRealTimers();
  });
});
