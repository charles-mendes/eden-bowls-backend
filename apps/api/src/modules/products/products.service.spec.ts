import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ProductsService } from './products.service';

type PrismaMock = {
  category: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
  };
  product: {
    count: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  category: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
  product: {
    count: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('ProductsService', () => {
  let prisma: PrismaMock;
  let service: ProductsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new ProductsService(prisma as never);
  });

  it('listCategories should return locale-aware categories', async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: 'cat_1', slug: 'dry-food', namePt: 'Ração', nameEn: 'Dry Food' },
    ]);

    const output = await service.listCategories({ locale: 'en-US', market: 'BR' });

    expect(prisma.category.findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        products: {
          some: {
            active: true,
            marketConfigs: {
              some: {
                marketCountry: 'BR',
                active: true,
              },
            },
          },
        },
      },
      orderBy: { namePt: 'asc' },
      select: {
        id: true,
        slug: true,
        namePt: true,
        nameEn: true,
      },
    });
    expect(output).toEqual([
      {
        id: 'cat_1',
        slug: 'dry-food',
        name: 'Dry Food',
        namePt: 'Ração',
        nameEn: 'Dry Food',
      },
    ]);
  });

  it('listProducts should return paginated localized products', async () => {
    prisma.$transaction.mockResolvedValue([
      1,
      [
        {
          id: 'prod_1',
          slug: 'super-premium',
          namePt: 'Super Premium',
          nameEn: 'Super Premium EN',
          descriptionPt: 'Descrição',
          descriptionEn: 'Description',
          category: { id: 'cat_1', slug: 'dry-food', namePt: 'Ração', nameEn: 'Dry Food' },
        },
      ],
    ]);

    const output = await service.listProducts({ locale: 'en-US', page: 1, perPage: 20, market: 'BR', currency: 'BRL' });

    expect(prisma.product.count).toHaveBeenCalled();
    expect(output.total).toBe(1);
    expect(output.items[0].name).toBe('Super Premium EN');
    expect(output.items[0].category.name).toBe('Dry Food');
  });

  it('listProductVariants should reject missing products', async () => {
    prisma.product.findFirst.mockResolvedValue(null);

    await expect(service.listProductVariants('prod_1', {})).rejects.toThrow(NotFoundException);
  });

  it('listProductVariants should return effective prices', async () => {
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod_1',
      slug: 'super-premium',
      namePt: 'Ração',
      nameEn: 'Food',
      variants: [
        {
          id: 'variant_1',
          sku: 'SKU-1',
          flavorKey: 'chicken',
          weightLabel: '1kg',
          grams: 1000,
          variantPrices: [
            {
              currency: 'BRL',
              regularPrice: new Prisma.Decimal('100'),
              salePrice: new Prisma.Decimal('80'),
              saleFrom: new Date('2026-01-01T00:00:00.000Z'),
              saleTo: new Date('2026-12-31T00:00:00.000Z'),
            },
          ],
        },
      ],
    });

    const output = await service.listProductVariants('prod_1', { currency: 'BRL', locale: 'en-US' });

    expect(output.product.name).toBe('Food');
    expect(output.variants[0].price?.amount).toBe(80);
    expect(output.variants[0].price?.hasDiscount).toBe(true);
  });

});
