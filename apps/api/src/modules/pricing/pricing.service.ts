import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AdminListPricingQueryDto } from './dto/admin-list-pricing-query.dto';
import { AdminUpsertPriceDto } from './dto/admin-upsert-price.dto';
import { CalculatePlanDto } from './dto/calculate-plan.dto';
import { ListPlansQueryDto } from './dto/list-plans-query.dto';

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async listPlans(query: ListPlansQueryDto) {
    const now = new Date();

    const plans = await this.prisma.subscriptionTerm.findMany({
      where: {
        active: true,
        ...(query.market
          ? { marketCountry: query.market.toUpperCase() }
          : {}),
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: [{ months: 'asc' }, { effectiveFrom: 'desc' }],
    });

    if (plans.length === 0) {
      throw new NotFoundException('No active terms found');
    }

    return plans.map((plan) => ({
      id: plan.id,
      marketCountry: plan.marketCountry,
      months: plan.months,
      discountPercent: Number(plan.discountPercent),
      effectiveFrom: plan.effectiveFrom,
      effectiveTo: plan.effectiveTo,
    }));
  }

  async getPlanById(planId: string) {
    const now = new Date();

    const plan = await this.prisma.subscriptionTerm.findFirst({
      where: {
        id: planId,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
    });

    if (!plan) {
      throw new NotFoundException('Plan not found');
    }

    return {
      id: plan.id,
      marketCountry: plan.marketCountry,
      months: plan.months,
      discountPercent: Number(plan.discountPercent),
      effectiveFrom: plan.effectiveFrom,
      effectiveTo: plan.effectiveTo,
    };
  }

  async calculatePlan(input: CalculatePlanDto) {
    const now = new Date();
    const market = input.market.toUpperCase();
    const currency = input.currency.toUpperCase();

    const term = await this.prisma.subscriptionTerm.findFirst({
      where: {
        marketCountry: market,
        months: input.termMonths,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!term) {
      throw new NotFoundException('No active term for selected months');
    }

    const planProducts = await this.prisma.productMarketConfig.findMany({
      where: {
        marketCountry: market,
        currency,
        isPlanProduct: true,
        active: true,
        product: { active: true },
      },
      select: {
        product: {
          select: {
            id: true,
            variants: {
              where: { active: true },
              select: {
                id: true,
                variantPrices: {
                  where: { currency },
                  orderBy: { createdAt: 'desc' },
                },
              },
            },
          },
        },
      },
    });

    let basePricePerPet: number | null = null;
    for (const item of planProducts) {
      for (const variant of item.product.variants) {
        const price = variant.variantPrices[0];
        if (!price) {
          continue;
        }

        const effective = this.resolveEffectivePrice(price, now);
        if (!effective) {
          continue;
        }

        if (basePricePerPet === null || effective.amount < basePricePerPet) {
          basePricePerPet = effective.amount;
        }
      }
    }

    if (basePricePerPet === null) {
      throw new NotFoundException('No active price for selected market/currency');
    }

    const petCount = input.pets.length;
    const subtotal = this.roundCurrency(basePricePerPet * petCount);
    const discountPercent = Number(term.discountPercent);
    const discount = this.roundCurrency(subtotal * (discountPercent / 100));
    const total = this.roundCurrency(subtotal - discount);

    return {
      market,
      currency,
      petCount,
      months: term.months,
      subtotal,
      discountPercent,
      discount,
      total,
    };
  }

  async adminListPricing(query: AdminListPricingQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.VariantPriceWhereInput = {
      ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
      ...(query.market
        ? {
            variant: {
              product: {
                marketConfigs: {
                  some: {
                    marketCountry: query.market.toUpperCase(),
                    ...(query.currency
                      ? { currency: query.currency.toUpperCase() }
                      : {}),
                  },
                },
              },
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.variantPrice.count({ where }),
      this.prisma.variantPrice.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          variant: {
            include: {
              product: {
                select: {
                  id: true,
                  slug: true,
                  namePt: true,
                  nameEn: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      perPage,
      items: items.map((item) => ({
        id: item.id,
        variantId: item.variantId,
        currency: item.currency,
        regularPrice: Number(item.regularPrice),
        salePrice: item.salePrice ? Number(item.salePrice) : null,
        saleFrom: item.saleFrom,
        saleTo: item.saleTo,
        source: item.source,
        createdAt: item.createdAt,
        product: {
          id: item.variant.product.id,
          slug: item.variant.product.slug,
          namePt: item.variant.product.namePt,
          nameEn: item.variant.product.nameEn,
        },
      })),
    };
  }

  async adminCreatePricing(input: AdminUpsertPriceDto) {
    if (input.salePrice !== undefined && input.salePrice > input.regularPrice) {
      throw new BadRequestException('salePrice must be <= regularPrice');
    }

    const variant = await this.prisma.productVariant.findUnique({
      where: { id: input.variantId },
      select: { id: true },
    });

    if (!variant) {
      throw new NotFoundException('Variant not found');
    }

    const created = await this.prisma.variantPrice.create({
      data: {
        variantId: input.variantId,
        currency: input.currency.toUpperCase(),
        regularPrice: new Prisma.Decimal(input.regularPrice),
        salePrice:
          input.salePrice === undefined
            ? undefined
            : new Prisma.Decimal(input.salePrice),
        saleFrom: input.saleFrom ? new Date(input.saleFrom) : undefined,
        saleTo: input.saleTo ? new Date(input.saleTo) : undefined,
        source: input.source,
      },
      select: {
        id: true,
      },
    });

    return {
      priceId: created.id,
    };
  }

  private resolveEffectivePrice(
    price: {
      currency: string;
      regularPrice: Prisma.Decimal;
      salePrice: Prisma.Decimal | null;
      saleFrom: Date | null;
      saleTo: Date | null;
    },
    now: Date,
  ) {
    const regular = Number(price.regularPrice);
    const saleValid =
      price.salePrice !== null &&
      (price.saleFrom === null || price.saleFrom <= now) &&
      (price.saleTo === null || price.saleTo >= now);

    const amount = saleValid ? Number(price.salePrice) : regular;

    return {
      currency: price.currency,
      regular,
      sale: price.salePrice ? Number(price.salePrice) : null,
      amount,
      hasDiscount: saleValid,
    };
  }

  private roundCurrency(value: number) {
    return Math.round(value * 100) / 100;
  }
}
