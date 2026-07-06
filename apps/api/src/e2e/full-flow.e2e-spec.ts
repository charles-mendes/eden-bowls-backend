import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request = require('supertest');

import { AppModule } from '../app.module';
import { PrismaService } from '../modules/prisma/prisma.service';

const RUN_E2E = (process.env.RUN_E2E ?? '').toLowerCase() === '1' || (process.env.RUN_E2E ?? '').toLowerCase() === 'true';
const describeE2E = RUN_E2E ? describe : describe.skip;

describeE2E('Full Flow E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let termId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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
    prisma = app.get(PrismaService);

    await cleanupData(prisma);
    termId = await seedCatalogAndTerms(prisma);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should execute onboarding -> recommendation -> checkout -> orders -> subscriptions', async () => {
    const email = `e2e-${Date.now()}@example.com`;
    const password = 'secret123';

    const registerRes = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password })
      .expect(201);

    const accessToken: string = registerRes.body.accessToken;
    expect(accessToken).toBeTruthy();

    const startSessionRes = await request(app.getHttpServer())
      .post('/api/v1/onboarding/sessions')
      .send({ country: 'BR', locale: 'pt-BR', state: 'SP' })
      .expect(201);

    const sessionId: string = startSessionRes.body.id;
    const sessionToken: string = startSessionRes.body.sessionToken;
    expect(sessionId).toBeTruthy();
    expect(sessionToken).toBeTruthy();

    const createPetRes = await request(app.getHttpServer())
      .post('/api/v1/pets')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Thor',
        species: 'dog',
        weightKg: 12,
        neutered: true,
        activityLevel: 'moderate',
      })
      .expect(201);

    const petId: string = createPetRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/pets`)
      .set('x-onboarding-token', sessionToken)
      .send({ petId })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/questionnaire`)
      .set('x-onboarding-token', sessionToken)
      .send({ answers: { activity: 'moderate' } })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/account-link`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({})
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/onboarding/sessions/${sessionId}/recommendation`)
      .set('x-onboarding-token', sessionToken)
      .expect(200);

    const snapshotRes = await request(app.getHttpServer())
      .get(`/api/v1/onboarding/sessions/${sessionId}/plan/snapshot`)
      .set('x-onboarding-token', sessionToken)
      .expect(200);

    const snapshotHash: string = snapshotRes.body.snapshotHash;

    const quoteRes = await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/shipping/quote`)
      .send({
        destination: { country: 'BR', postcode: '01310-000' },
        items: [{ quantity: 1, unitPrice: 120 }],
      })
      .expect(201);

    const quoteId: string = quoteRes.body.quoteId;
    const rateId: string = quoteRes.body.rates[0].rateId;

    await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/shipping/select`)
      .send({ quoteId, rateId })
      .expect(201);

    const checkoutRes = await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/checkout`)
      .set('idempotency-key', `idem-${Date.now()}`)
      .send({
        snapshotHash,
        selectedShipping: { quoteId, rateId },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      })
      .expect(201);

    const paymentIntentId: string = checkoutRes.body.paymentIntentRef;

    await request(app.getHttpServer())
      .post(`/api/v1/onboarding/sessions/${sessionId}/payment-intent/ack`)
      .send({ paymentIntentId, status: 'succeeded' })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.paymentState).toBe('succeeded');
      });

    await request(app.getHttpServer())
      .get('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }: { body: { total: number } }) => {
        expect(body.total).toBeGreaterThanOrEqual(1);
      });

    await request(app.getHttpServer())
      .post('/api/v1/billing/subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('idempotency-key', `sub-idem-${Date.now()}`)
      .send({
        paymentMethodId: 'pm_test_1',
        termId,
        providerSubscriptionId: `prov-${Date.now()}`,
      })
      .expect(201)
      .expect(({ body }: { body: Record<string, unknown> }) => {
        expect(body.subscriptionId).toBeTruthy();
      });

    await request(app.getHttpServer())
      .get('/api/v1/billing/subscriptions')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200)
      .expect(({ body }: { body: unknown[] }) => {
        expect(Array.isArray(body)).toBe(true);
        expect(body.length).toBeGreaterThanOrEqual(1);
      });
  });
});

async function seedCatalogAndTerms(prisma: PrismaService): Promise<string> {
  const category = await prisma.category.create({
    data: {
      slug: `e2e-category-${Date.now()}`,
      namePt: 'Categoria E2E',
      nameEn: 'E2E Category',
      active: true,
    },
  });

  const product = await prisma.product.create({
    data: {
      categoryId: category.id,
      slug: `e2e-product-${Date.now()}`,
      namePt: 'Produto E2E',
      nameEn: 'E2E Product',
      active: true,
    },
  });

  const variant = await prisma.productVariant.create({
    data: {
      productId: product.id,
      sku: `E2E-SKU-${Date.now()}`,
      flavorKey: 'chicken',
      weightLabel: '1kg',
      grams: 1000,
      active: true,
    },
  });

  await prisma.productMarketConfig.create({
    data: {
      productId: product.id,
      marketCountry: 'BR',
      currency: 'BRL',
      planDays: 30,
      isPlanProduct: true,
      active: true,
    },
  });

  await prisma.variantPrice.create({
    data: {
      variantId: variant.id,
      currency: 'BRL',
      regularPrice: new Prisma.Decimal(100),
      source: 'e2e_seed',
    },
  });

  const term = await prisma.subscriptionTerm.create({
    data: {
      marketCountry: 'BR',
      months: 3,
      discountPercent: new Prisma.Decimal(10),
      active: true,
      effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
    },
  });

  return term.id;
}

async function cleanupData(prisma: PrismaService) {
  await prisma.orderStatusHistory.deleteMany();
  await prisma.order.deleteMany();
  await prisma.subscriptionEvent.deleteMany();
  await prisma.subscriptionItem.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.checkoutShippingSelection.deleteMany();
  await prisma.checkoutOrderItem.deleteMany();
  await prisma.checkoutOrder.deleteMany();
  await prisma.shippingQuoteRate.deleteMany();
  await prisma.shippingQuote.deleteMany();
  await prisma.planSnapshot.deleteMany();
  await prisma.recommendationPetResult.deleteMany();
  await prisma.recommendationRun.deleteMany();
  await prisma.onboardingAnswer.deleteMany();
  await prisma.onboardingSessionPet.deleteMany();
  await prisma.onboardingSession.deleteMany();
  await prisma.pet.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.user.deleteMany();
  await prisma.variantPrice.deleteMany();
  await prisma.productMarketConfig.deleteMany();
  await prisma.productVariant.deleteMany();
  await prisma.product.deleteMany();
  await prisma.category.deleteMany();
  await prisma.subscriptionTerm.deleteMany();
  await prisma.idempotencyKey.deleteMany();
}
