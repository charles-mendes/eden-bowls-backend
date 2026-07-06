import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { AppModule } from '../app.module';
import { CatalogService } from '../modules/catalog/catalog.service';
import { PrismaService } from '../modules/prisma/prisma.service';
import { PricingService } from '../modules/pricing/pricing.service';

describe('Catalog/Pricing Contracts E2E', () => {
  let app: INestApplication;

  const catalogService = {
    listPlans: jest.fn(),
    getPlanById: jest.fn(),
    listCategories: jest.fn(),
    listProducts: jest.fn(),
    listProductVariants: jest.fn(),
  };

  const pricingService = {
    calculatePlan: jest.fn(),
    listPlans: jest.fn(),
    getPlanById: jest.fn(),
    adminListPricing: jest.fn(),
    adminCreatePricing: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .overrideProvider(CatalogService)
      .useValue(catalogService)
      .overrideProvider(PricingService)
      .useValue(pricingService)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/v1/catalog/plans should keep public plans list contract stable', async () => {
    catalogService.listPlans.mockResolvedValue([
      {
        id: 'term_1',
        marketCountry: 'BR',
        months: 3,
        discountPercent: 10,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v1/catalog/plans?market=BR&currency=BRL')
      .expect(200);

    expect(catalogService.listPlans).toHaveBeenCalledWith({
      market: 'BR',
      currency: 'BRL',
    });
    expect(response.body).toEqual([
      {
        id: 'term_1',
        marketCountry: 'BR',
        months: 3,
        discountPercent: 10,
      },
    ]);
  });

  it('GET /api/v1/catalog/plans/:planId should keep public plan detail contract stable', async () => {
    catalogService.getPlanById.mockResolvedValue({
      id: 'term_1',
      marketCountry: 'BR',
      months: 6,
      discountPercent: 15,
    });

    const response = await request(app.getHttpServer())
      .get('/api/v1/catalog/plans/term_1')
      .expect(200);

    expect(catalogService.getPlanById).toHaveBeenCalledWith('term_1');
    expect(response.body).toEqual({
      id: 'term_1',
      marketCountry: 'BR',
      months: 6,
      discountPercent: 15,
    });
  });

  it('POST /api/v1/catalog/plans/calculate should keep calculation contract stable', async () => {
    pricingService.calculatePlan.mockResolvedValue({
      market: 'BR',
      currency: 'BRL',
      petCount: 1,
      months: 3,
      subtotal: 100,
      discountPercent: 10,
      discount: 10,
      total: 90,
    });

    const payload = {
      pets: [{ weightKg: 12 }],
      termMonths: 3,
      market: 'BR',
      currency: 'BRL',
    };

    const response = await request(app.getHttpServer())
      .post('/api/v1/catalog/plans/calculate')
      .send(payload)
      .expect(201);

    expect(pricingService.calculatePlan).toHaveBeenCalledWith(payload);
    expect(response.body).toEqual({
      market: 'BR',
      currency: 'BRL',
      petCount: 1,
      months: 3,
      subtotal: 100,
      discountPercent: 10,
      discount: 10,
      total: 90,
    });
  });

  it('POST /api/v1/catalog/plans/calculate should reject invalid payloads', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/catalog/plans/calculate')
      .send({
        pets: [],
        termMonths: 3,
        market: 'BR',
        currency: 'BRL',
      })
      .expect(400);

    expect(pricingService.calculatePlan).not.toHaveBeenCalled();
  });
});
