import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PricingService } from './pricing.service';

type PrismaMock = {
  subscriptionTerm: {
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  productMarketConfig: {
    findMany: jest.Mock;
  };
  variantPrice: {
    count: jest.Mock;
    findMany: jest.Mock;
    create: jest.Mock;
  };
  productVariant: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  subscriptionTerm: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
  },
  productMarketConfig: {
    findMany: jest.fn(),
  },
  variantPrice: {
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('PricingService', () => {
  let prisma: PrismaMock;
  let service: PricingService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new PricingService(prisma as never);
  });

  it('listPlans should return active plans', async () => {
    prisma.subscriptionTerm.findMany.mockResolvedValue([
      {
        id: 'term_1',
        marketCountry: 'BR',
        months: 3,
        discountPercent: new Prisma.Decimal('10'),
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        effectiveTo: null,
      },
    ]);

    const output = await service.listPlans({ market: 'BR' });

    expect(output[0].id).toBe('term_1');
    expect(output[0].discountPercent).toBe(10);
  });

  it('getPlanById should reject missing plans', async () => {
    prisma.subscriptionTerm.findFirst.mockResolvedValue(null);

    await expect(service.getPlanById('term_1')).rejects.toThrow(NotFoundException);
  });

  it('calculatePlan should compute totals from the lowest active price', async () => {
    prisma.subscriptionTerm.findFirst.mockResolvedValue({
      id: 'term_1',
      marketCountry: 'BR',
      months: 3,
      discountPercent: new Prisma.Decimal('10'),
      active: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
    prisma.productMarketConfig.findMany.mockResolvedValue([
      {
        product: {
          id: 'prod_1',
          variants: [
            {
              id: 'variant_1',
              variantPrices: [
                {
                  currency: 'BRL',
                  regularPrice: new Prisma.Decimal('100'),
                  salePrice: null,
                  saleFrom: null,
                  saleTo: null,
                },
              ],
            },
          ],
        },
      },
    ]);

    const output = await service.calculatePlan({
      pets: [{ weightKg: 10 }],
      termMonths: 3,
      market: 'BR',
      currency: 'BRL',
    });

    expect(output.market).toBe('BR');
    expect(output.total).toBeGreaterThan(0);
  });

  it('calculatePlan should reject when no price exists', async () => {
    prisma.subscriptionTerm.findFirst.mockResolvedValue({
      id: 'term_1',
      marketCountry: 'BR',
      months: 3,
      discountPercent: new Prisma.Decimal('10'),
      active: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
    });
    prisma.productMarketConfig.findMany.mockResolvedValue([]);

    await expect(
      service.calculatePlan({ pets: [{ weightKg: 10 }], termMonths: 3, market: 'BR', currency: 'BRL' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('adminListPricing should paginate mapped prices', async () => {
    prisma.$transaction.mockResolvedValue([
      1,
      [
        {
          id: 'price_1',
          variantId: 'variant_1',
          currency: 'BRL',
          regularPrice: new Prisma.Decimal('100'),
          salePrice: new Prisma.Decimal('80'),
          saleFrom: null,
          saleTo: null,
          source: 'manual',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          variant: { product: { id: 'prod_1', slug: 'super-premium', namePt: 'Racao', nameEn: 'Food' } },
        },
      ],
    ]);

    const output = await service.adminListPricing({ page: 1, perPage: 20 });

    expect(output.total).toBe(1);
    expect(output.items[0].regularPrice).toBe(100);
    expect(output.items[0].product.slug).toBe('super-premium');
  });

  it('adminCreatePricing should reject sale prices above regular prices', async () => {
    await expect(
      service.adminCreatePricing({
        variantId: 'variant_1',
        currency: 'BRL',
        regularPrice: 10,
        salePrice: 20,
        source: 'manual',
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('adminCreatePricing should create pricing for an existing variant', async () => {
    prisma.productVariant.findUnique.mockResolvedValue({ id: 'variant_1' });
    prisma.variantPrice.create.mockResolvedValue({ id: 'price_1' });

    const output = await service.adminCreatePricing({
      variantId: 'variant_1',
      currency: 'BRL',
      regularPrice: 10,
      source: 'manual',
    });

    expect(output).toEqual({ priceId: 'price_1' });
  });
});
