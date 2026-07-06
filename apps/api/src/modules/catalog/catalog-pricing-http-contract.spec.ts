import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PricingController } from '../pricing/pricing.controller';
import { PricingService } from '../pricing/pricing.service';

describe('Catalog/Pricing HTTP Contracts', () => {
  let app: INestApplication;
  let catalogService: {
    listPlans: jest.Mock;
    getPlanById: jest.Mock;
  };
  let pricingService: {
    calculatePlan: jest.Mock;
  };

  beforeAll(async () => {
    catalogService = {
      listPlans: jest.fn(),
      getPlanById: jest.fn(),
    };

    pricingService = {
      calculatePlan: jest.fn(),
    };

    const moduleBuilder = Test.createTestingModule({
      controllers: [CatalogController, PricingController],
      providers: [
        {
          provide: CatalogService,
          useValue: {
            listCategories: jest.fn(),
            listProducts: jest.fn(),
            listProductVariants: jest.fn(),
            listPlans: catalogService.listPlans,
            getPlanById: catalogService.getPlanById,
          },
        },
        {
          provide: PricingService,
          useValue: {
            calculatePlan: pricingService.calculatePlan,
            listPlans: jest.fn(),
            getPlanById: jest.fn(),
            adminListPricing: jest.fn(),
            adminCreatePricing: jest.fn(),
          },
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) });

    const moduleRef = await moduleBuilder.compile();

    app = moduleRef.createNestApplication();
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
    catalogService.listPlans.mockReset();
    catalogService.getPlanById.mockReset();
    pricingService.calculatePlan.mockReset();
  });

  it('GET /catalog/plans should keep public plans read contract stable', async () => {
    catalogService.listPlans.mockResolvedValue([
      {
        id: 'term_1',
        marketCountry: 'BR',
        months: 3,
        discountPercent: 10,
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/catalog/plans?market=BR&currency=BRL')
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

  it('GET /catalog/plans/:planId should keep plan detail contract stable', async () => {
    catalogService.getPlanById.mockResolvedValue({
      id: 'term_1',
      marketCountry: 'BR',
      months: 6,
      discountPercent: 15,
    });

    const response = await request(app.getHttpServer())
      .get('/catalog/plans/term_1')
      .expect(200);

    expect(catalogService.getPlanById).toHaveBeenCalledWith('term_1');
    expect(response.body).toEqual({
      id: 'term_1',
      marketCountry: 'BR',
      months: 6,
      discountPercent: 15,
    });
  });

  it('POST /catalog/plans/calculate should accept valid payload and preserve contract', async () => {
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
      .post('/catalog/plans/calculate')
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

  it('POST /catalog/plans/calculate should reject invalid payloads via DTO validation', async () => {
    await request(app.getHttpServer())
      .post('/catalog/plans/calculate')
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
