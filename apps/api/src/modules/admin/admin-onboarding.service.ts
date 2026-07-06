import { Injectable, NotFoundException } from '@nestjs/common';
import { OnboardingStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

import { AdminListQueryDto } from './dto/admin-list-query.dto';

@Injectable()
export class AdminOnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  async listSessions(query: AdminListQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const [total, items] = await this.prisma.$transaction([
      this.prisma.onboardingSession.count(),
      this.prisma.onboardingSession.findMany({
        skip,
        take: perPage,
        orderBy: { updatedAt: 'desc' },
        include: {
          linkedUser: {
            select: {
              id: true,
              email: true,
            },
          },
          _count: {
            select: {
              sessionPets: true,
              answers: true,
              recommendationRuns: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
      items,
    };
  }

  async getSession360(sessionId: string) {
    const session = await this.prisma.onboardingSession.findUnique({
      where: { id: sessionId },
      include: {
        linkedUser: {
          select: {
            id: true,
            email: true,
            status: true,
          },
        },
        sessionPets: {
          orderBy: { sortOrder: 'asc' },
          include: {
            pet: {
              select: {
                id: true,
                name: true,
                species: true,
                weightKg: true,
                activityLevel: true,
                nutritionGoal: true,
              },
            },
          },
        },
        answers: {
          orderBy: { updatedAt: 'asc' },
        },
        recommendationRuns: {
          orderBy: { createdAt: 'desc' },
          include: {
            petResults: true,
            planSnapshots: true,
          },
        },
        checkoutOrders: {
          orderBy: { createdAt: 'desc' },
          include: {
            orders: true,
            subscriptions: true,
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('onboarding_session_not_found');
    }

    return session;
  }

  async getMetrics() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const grouped = await this.prisma.onboardingSession.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const totalSessions = grouped.reduce((acc, item) => acc + item._count._all, 0);
    const byStatus = this.toStatusMap(grouped);

    const expiringIn24h = await this.prisma.onboardingSession.count({
      where: {
        expiresAt: {
          gte: now,
          lte: in24h,
        },
        status: {
          in: [OnboardingStatus.started, OnboardingStatus.in_progress],
        },
      },
    });

    return {
      totalSessions,
      byStatus,
      expiringIn24h,
      generatedAt: now,
    };
  }

  private toStatusMap(
    grouped: Array<{
      status: OnboardingStatus;
      _count: { _all: number };
    }>,
  ) {
    const base: Record<OnboardingStatus, number> = {
      started: 0,
      in_progress: 0,
      ready_for_checkout: 0,
      completed: 0,
      abandoned: 0,
    };

    for (const item of grouped) {
      base[item.status] = item._count._all;
    }

    return base;
  }
}