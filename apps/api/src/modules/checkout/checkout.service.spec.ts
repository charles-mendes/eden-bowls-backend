import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutOrderStatus, Prisma } from '@prisma/client';

import { CheckoutService } from './checkout.service';

type PrismaMock = {
  onboardingSession: {
    findUnique: jest.Mock;
  };
  idempotencyKey: {
    findUnique: jest.Mock;
  };
  planSnapshot: {
    findFirst: jest.Mock;
  };
  shippingQuote: {
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  productMarketConfig: {
    findMany: jest.Mock;
  };
  checkoutOrder: {
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  onboardingSession: {
    findUnique: jest.fn(),
  },
  idempotencyKey: {
    findUnique: jest.fn(),
  },
  planSnapshot: {
    findFirst: jest.fn(),
  },
  shippingQuote: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  productMarketConfig: {
    findMany: jest.fn(),
  },
  checkoutOrder: {
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('CheckoutService', () => {
  let prisma: PrismaMock;
  let service: CheckoutService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new CheckoutService(prisma as never);
  });

  it('createCheckoutOrder should require idempotency key', async () => {
    await expect(
      service.createCheckoutOrder('session_1', undefined, {
        snapshotHash: 'snap_1',
        selectedShipping: { quoteId: '11111111-1111-1111-1111-111111111111', rateId: '22222222-2222-2222-2222-222222222222' },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('createCheckoutOrder should reject missing session', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue(null);

    await expect(
      service.createCheckoutOrder('session_1', 'idem-1', {
        snapshotHash: 'snap_1',
        selectedShipping: { quoteId: '11111111-1111-1111-1111-111111111111', rateId: '22222222-2222-2222-2222-222222222222' },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('createCheckoutOrder should require linked account', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue({ id: 'session_1', linkedUserId: null, sessionPets: [], recommendationRuns: [] });

    await expect(
      service.createCheckoutOrder('session_1', 'idem-1', {
        snapshotHash: 'snap_1',
        selectedShipping: { quoteId: '11111111-1111-1111-1111-111111111111', rateId: '22222222-2222-2222-2222-222222222222' },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('createCheckoutOrder should reject idempotency conflict', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue({
      id: 'session_1',
      linkedUserId: 'user_1',
      sessionPets: [],
      recommendationRuns: [],
      country: 'BR',
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'other-hash' });

    await expect(
      service.createCheckoutOrder('session_1', 'idem-1', {
        snapshotHash: 'snap_1',
        selectedShipping: { quoteId: '11111111-1111-1111-1111-111111111111', rateId: '22222222-2222-2222-2222-222222222222' },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('createCheckoutOrder should return cached idempotent response', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue({
      id: 'session_1',
      linkedUserId: 'user_1',
      sessionPets: [],
      recommendationRuns: [],
      country: 'BR',
    });

    const payload = {
      snapshotHash: 'snap_1',
      selectedShipping: { quoteId: '11111111-1111-1111-1111-111111111111', rateId: '22222222-2222-2222-2222-222222222222' },
      billingAddress: {
        country: 'BR',
        state: 'SP',
        city: 'Sao Paulo',
        postcode: '01310-000',
        address1: 'Av Paulista, 1000',
      },
    };

    prisma.idempotencyKey.findUnique.mockResolvedValue({
      requestHash: (service as any).hashPayload(payload),
      responseJson: { checkoutOrderId: 'co_1', paymentIntentRef: 'pi_1', status: CheckoutOrderStatus.pending_payment },
    });

    const output = await service.createCheckoutOrder('session_1', 'idem-1', payload as never);

    expect(output).toEqual({ checkoutOrderId: 'co_1', paymentIntentRef: 'pi_1', status: CheckoutOrderStatus.pending_payment });
  });

  it('createCheckoutOrder should reject snapshot mismatch', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue({
      id: 'session_1',
      linkedUserId: 'user_1',
      sessionPets: [],
      recommendationRuns: [],
      country: 'BR',
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.planSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      service.createCheckoutOrder('session_1', 'idem-1', {
        snapshotHash: 'snap_1',
        selectedShipping: { quoteId: '11111111-1111-1111-1111-111111111111', rateId: '22222222-2222-2222-2222-222222222222' },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('createCheckoutOrder should create checkout order and persist idempotency', async () => {
    prisma.onboardingSession.findUnique.mockResolvedValue({
      id: 'session_1',
      linkedUserId: 'user_1',
      country: 'BR',
      sessionPets: [{ petId: 'pet_1', pet: { name: 'Thor' } }],
      recommendationRuns: [],
    });
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.planSnapshot.findFirst.mockResolvedValue({
      id: 'snapshot_1',
      snapshotHash: 'snap_1',
      currency: 'BRL',
      subtotalAmount: new Prisma.Decimal('120'),
      totalAmount: new Prisma.Decimal('140'),
      runId: 'run_1',
      run: { sessionId: 'session_1' },
    });
    prisma.shippingQuote.findFirst.mockResolvedValue({
      id: 'quote_1',
      sessionId: 'session_1',
      selectedRateId: '22222222-2222-2222-2222-222222222222',
      provider: 'manual_local',
      currency: 'BRL',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      rates: [
        {
          id: '22222222-2222-2222-2222-222222222222',
          serviceCode: 'manual_local_standard',
          serviceLabel: 'Entrega local padrao',
          amount: new Prisma.Decimal('20'),
          etaMinDays: 1,
          etaMaxDays: 2,
        },
      ],
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
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        checkoutOrder: {
          create: jest.fn().mockResolvedValue({ id: 'co_1', status: CheckoutOrderStatus.pending_payment }),
          update: jest.fn(),
        },
        idempotencyKey: {
          create: jest.fn().mockResolvedValue({ id: 'idem_1' }),
        },
        order: {
          create: jest.fn(),
        },
      };
      return callback(tx);
    });

    const output = await service.createCheckoutOrder('session_1', 'idem-1', {
      snapshotHash: 'snap_1',
      selectedShipping: { quoteId: 'quote_1', rateId: '22222222-2222-2222-2222-222222222222' },
      billingAddress: {
        country: 'BR',
        state: 'SP',
        city: 'Sao Paulo',
        postcode: '01310-000',
        address1: 'Av Paulista, 1000',
      },
    } as never);

    expect(output.checkoutOrderId).toBe('co_1');
    expect(output.status).toBe(CheckoutOrderStatus.pending_payment);
  });

  it('acknowledgePaymentIntent should reject missing order', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([]);

    await expect(
      service.acknowledgePaymentIntent('session_1', { paymentIntentId: 'pi_1', status: 'succeeded' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('acknowledgePaymentIntent should reject invalid transitions', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([
      {
        id: 'co_1',
        paymentState: 'succeeded',
        metadataJson: { paymentIntentRef: 'pi_1' },
        orders: [],
      },
    ]);

    await expect(
      service.acknowledgePaymentIntent('session_1', { paymentIntentId: 'pi_1', status: 'processing' }),
    ).rejects.toThrow(ConflictException);
  });

  it('acknowledgePaymentIntent should update state and create order when payment succeeds', async () => {
    prisma.checkoutOrder.findMany.mockResolvedValue([
      {
        id: 'co_1',
        userId: 'user_1',
        paymentState: 'requires_confirmation',
        metadataJson: { paymentIntentRef: 'pi_1' },
        orders: [],
      },
    ]);
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => Promise<unknown>) => {
      const tx = {
        checkoutOrder: {
          update: jest.fn().mockResolvedValue({ id: 'co_1', paymentState: 'succeeded' }),
        },
        order: {
          create: jest.fn().mockResolvedValue({ id: 'order_1' }),
        },
      };
      return callback(tx);
    });

    const output = await service.acknowledgePaymentIntent('session_1', { paymentIntentId: 'pi_1', status: 'succeeded' });

    expect(output).toEqual({ paymentState: 'succeeded' });
  });
});
