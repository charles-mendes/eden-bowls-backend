import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminListProductsQueryDto } from './dto/admin-list-products-query.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { ListVariantsQueryDto } from './dto/list-variants-query.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(query: ListCategoriesQueryDto) {
    const locale = (query.locale ?? 'pt').toLowerCase();

    const categories = await this.prisma.category.findMany({
      where: {
        active: true,
        products: {
          some: {
            active: true,
            ...(query.market
              ? {
                  marketConfigs: {
                    some: {
                      marketCountry: query.market.toUpperCase(),
                      active: true,
                    },
                  },
                }
              : {}),
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

    return categories.map((item) => ({
      id: item.id,
      slug: item.slug,
      name: locale.startsWith('en') ? item.nameEn : item.namePt,
      namePt: item.namePt,
      nameEn: item.nameEn,
    }));
  }

  async listProducts(query: ListProductsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;
    const locale = (query.locale ?? 'pt').toLowerCase();

    const where: Prisma.ProductWhereInput = {
      active: true,
      ...(query.category ? { category: { slug: query.category } } : {}),
      ...(query.market
        ? {
            marketConfigs: {
              some: {
                marketCountry: query.market.toUpperCase(),
                ...(query.currency ? { currency: query.currency.toUpperCase() } : {}),
                active: true,
              },
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          slug: true,
          namePt: true,
          nameEn: true,
          descriptionPt: true,
          descriptionEn: true,
          category: {
            select: {
              id: true,
              slug: true,
              namePt: true,
              nameEn: true,
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
        slug: item.slug,
        name: locale.startsWith('en') ? item.nameEn : item.namePt,
        namePt: item.namePt,
        nameEn: item.nameEn,
        description: locale.startsWith('en')
          ? item.descriptionEn
          : item.descriptionPt,
        descriptionPt: item.descriptionPt,
        descriptionEn: item.descriptionEn,
        category: {
          id: item.category.id,
          slug: item.category.slug,
          name: locale.startsWith('en')
            ? item.category.nameEn
            : item.category.namePt,
        },
      })),
    };
  }

  async listProductVariants(productId: string, query: ListVariantsQueryDto) {
    const locale = (query.locale ?? 'pt').toLowerCase();
    const now = new Date();

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        active: true,
        ...(query.market
          ? {
              marketConfigs: {
                some: {
                  marketCountry: query.market.toUpperCase(),
                  ...(query.currency
                    ? { currency: query.currency.toUpperCase() }
                    : {}),
                  active: true,
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        slug: true,
        namePt: true,
        nameEn: true,
        variants: {
          where: { active: true },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            sku: true,
            flavorKey: true,
            weightLabel: true,
            grams: true,
            variantPrices: {
              where: {
                ...(query.currency
                  ? { currency: query.currency.toUpperCase() }
                  : {}),
              },
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundException('Product not found');
    }

    return {
      product: {
        id: product.id,
        slug: product.slug,
        name: locale.startsWith('en') ? product.nameEn : product.namePt,
      },
      variants: product.variants.map((variant) => {
        const selectedPrice = variant.variantPrices[0];
        const effective = selectedPrice
          ? this.resolveEffectivePrice(selectedPrice, now)
          : null;

        return {
          id: variant.id,
          sku: variant.sku,
          flavorKey: variant.flavorKey,
          weightLabel: variant.weightLabel,
          grams: variant.grams,
          price: effective,
        };
      }),
    };
  }

  async adminListProducts(query: AdminListProductsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.ProductWhereInput = {
      ...(query.search
        ? {
            OR: [
              { slug: { contains: query.search } },
              { namePt: { contains: query.search } },
              { nameEn: { contains: query.search } },
            ],
          }
        : {}),
      ...(query.market
        ? {
            marketConfigs: {
              some: {
                marketCountry: query.market.toUpperCase(),
              },
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          category: true,
          marketConfigs: true,
          variants: {
            include: {
              variantPrices: true,
            },
          },
        },
      }),
    ]);

    return {
      total,
      page,
      perPage,
      items,
    };
  }

  async adminCreateProduct(input: AdminCreateProductDto) {
    const category = await this.prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    });

    if (!category) {
      throw new BadRequestException('Category not found');
    }

    const existing = await this.prisma.product.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });

    if (existing) {
      throw new BadRequestException('Slug already exists');
    }

    for (const variant of input.variants ?? []) {
      for (const price of variant.prices ?? []) {
        if (price.salePrice !== undefined && price.salePrice > price.regularPrice) {
          throw new BadRequestException('salePrice must be <= regularPrice');
        }
      }
    }

    const created = await this.prisma.product.create({
      data: {
        categoryId: input.categoryId,
        slug: input.slug,
        namePt: input.namePt,
        nameEn: input.nameEn,
        descriptionPt: input.descriptionPt,
        descriptionEn: input.descriptionEn,
        active: input.active ?? true,
        marketConfigs: {
          create: (input.marketConfigs ?? []).map((config) => ({
            marketCountry: config.marketCountry.toUpperCase(),
            currency: config.currency.toUpperCase(),
            planDays: config.planDays,
            isPlanProduct: config.isPlanProduct ?? false,
            active: config.active ?? true,
          })),
        },
        variants: {
          create: (input.variants ?? []).map((variant) => ({
            sku: variant.sku,
            flavorKey: variant.flavorKey,
            weightLabel: variant.weightLabel,
            grams: variant.grams,
            active: variant.active ?? true,
            variantPrices: {
              create: (variant.prices ?? []).map((price) => ({
                currency: price.currency.toUpperCase(),
                regularPrice: new Prisma.Decimal(price.regularPrice),
                salePrice:
                  price.salePrice === undefined
                    ? undefined
                    : new Prisma.Decimal(price.salePrice),
                saleFrom: price.saleFrom ? new Date(price.saleFrom) : undefined,
                saleTo: price.saleTo ? new Date(price.saleTo) : undefined,
                source: price.source,
              })),
            },
          })),
        },
      },
      select: {
        id: true,
      },
    });

    return {
      productId: created.id,
    };
  }

  async adminUpdateProduct(productId: string, input: AdminUpdateProductDto) {
    const current = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!current) {
      throw new NotFoundException('Product not found');
    }

    if (input.slug) {
      const duplicateSlug = await this.prisma.product.findFirst({
        where: {
          slug: input.slug,
          id: { not: productId },
        },
        select: { id: true },
      });

      if (duplicateSlug) {
        throw new BadRequestException('Slug already exists');
      }
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        slug: input.slug,
        namePt: input.namePt,
        nameEn: input.nameEn,
        descriptionPt: input.descriptionPt,
        descriptionEn: input.descriptionEn,
        active: input.active,
      },
    });
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

}
