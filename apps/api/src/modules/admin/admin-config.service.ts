import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { AdminBusinessRulesQueryDto } from './dto/admin-business-rules-query.dto';
import { UpdateBusinessRuleDto } from './dto/update-business-rule.dto';

@Injectable()
export class AdminConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listBusinessRules(query: AdminBusinessRulesQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.BusinessRulesConfigWhereInput = {
      ...(query.domain ? { domain: query.domain } : {}),
      ...(query.key ? { key: query.key } : {}),
      ...(query.marketCountry
        ? {
            marketCountry: query.marketCountry.toUpperCase(),
          }
        : {}),
      ...(query.active !== undefined ? { active: query.active } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.businessRulesConfig.count({ where }),
      this.prisma.businessRulesConfig.findMany({
        where,
        skip,
        take: perPage,
        orderBy: [{ domain: 'asc' }, { key: 'asc' }, { effectiveFrom: 'desc' }],
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

  async updateBusinessRule(id: string, dto: UpdateBusinessRuleDto) {
    const existing = await this.prisma.businessRulesConfig.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('business_rule_not_found');
    }

    const nextEffectiveTo = this.resolveEffectiveTo(dto.effectiveTo, existing.effectiveTo);
    const nextActive = dto.active ?? existing.active;

    if (
      nextEffectiveTo &&
      nextEffectiveTo.getTime() < existing.effectiveFrom.getTime()
    ) {
      throw new BadRequestException('effective_to_before_effective_from');
    }

    if (nextActive) {
      const overlap = await this.prisma.businessRulesConfig.findFirst({
        where: {
          id: { not: id },
          domain: existing.domain,
          key: existing.key,
          marketCountry: existing.marketCountry,
          active: true,
          effectiveFrom: {
            lte: nextEffectiveTo ?? new Date('9999-12-31T23:59:59.999Z'),
          },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: existing.effectiveFrom } },
          ],
        },
        select: { id: true },
      });

      if (overlap) {
        throw new ConflictException('business_rule_effective_range_overlap');
      }
    }

    const updated = await this.prisma.businessRulesConfig.update({
      where: { id },
      data: {
        ...(dto.valueJson
          ? {
              valueJson: dto.valueJson as Prisma.InputJsonValue,
            }
          : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo: nextEffectiveTo } : {}),
      },
    });

    await this.auditService.record({
      action: 'business_rules_config.update',
      resource: 'business_rules_config',
      resourceId: updated.id,
      beforeJson: existing as Prisma.InputJsonValue,
      afterJson: updated as Prisma.InputJsonValue,
    });

    return updated;
  }

  private resolveEffectiveTo(
    effectiveTo: string | null | undefined,
    fallback: Date | null,
  ) {
    if (effectiveTo === undefined) {
      return fallback;
    }

    if (effectiveTo === null) {
      return null;
    }

    const parsed = new Date(effectiveTo);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('invalid_effective_to');
    }

    return parsed;
  }
}