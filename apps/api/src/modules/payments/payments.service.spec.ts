import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus, WebhookState } from '@prisma/client';

import { AdminSubscriptionsQueryDto } from './dto/admin-subscriptions-query.dto';
import { AdminWebhooksQueryDto } from './dto/admin-webhooks-query.dto';
import { CatalogSyncDto } from './dto/catalog-sync.dto';
import { CatalogSyncHealthQueryDto } from './dto/catalog-sync-health-query.dto';
import { CatalogSyncStatusQueryDto } from './dto/catalog-sync-status-query.dto';
import { StripePriceQueryDto } from './dto/stripe-price-query.dto';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';
import { PaymentsService } from './payments.service';

type PrismaMock = {
  product: {
    findUnique: jest.Mock;
  };
  productMarketConfig: {
    findMany: jest.Mock;
  };
  stripeProductPriceMap: {
    findFirst: jest.Mock;
    findMany: jest.Mock;
  };
  webhookEvent: {
    create: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  subscription: {
    count: jest.Mock;
    findMany: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  product: {
    findUnique: jest.fn(),
  },
  productMarketConfig: {
    findMany: jest.fn(),
  },
  stripeProductPriceMap: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
  },
  webhookEvent: {
    create: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
  },
  subscription: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('PaymentsService', () => {
  let prisma: PrismaMock;
  let service: PaymentsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new PaymentsService(prisma as never);
  });

  it('syncCatalog should create a completed sync job', async () => {
    const output = await service.syncCatalog({ market: 'br', currency: 'brl' } as CatalogSyncDto);

    expect(output.status).toBe('completed');
    expect(output.syncJobId).toEqual(expect.any(String));
  });

  it('syncCatalog should reject when a matching sync job is already running', async () => {
    (service as any).syncJobs.set('job_1', {
      id: 'job_1',
      scope: 'market:BR:currency:BRL',
      status: 'running',
      market: 'BR',
      currency: 'BRL',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    await expect(service.syncCatalog({ market: 'br', currency: 'brl' } as CatalogSyncDto)).rejects.toThrow(
      ConflictException,
    );
  });

  it('syncCatalogProduct should reject when product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValue(null);

    await expect(service.syncCatalogProduct('product_1')).rejects.toThrow(NotFoundException);
  });

  it('syncCatalogProduct should create a completed sync job for a product', async () => {
    prisma.product.findUnique.mockResolvedValue({ id: 'product_1' });

    const output = await service.syncCatalogProduct('product_1');

    expect(output.status).toBe('completed');
    expect(output.syncJobId).toEqual(expect.any(String));
  });

  it('getSyncStatus should return the latest job when no id is provided', async () => {
    (service as any).syncJobs.set('job_1', {
      id: 'job_1',
      scope: 'market:BR:currency:BRL',
      status: 'completed',
      market: 'BR',
      currency: 'BRL',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    (service as any).syncJobs.set('job_2', {
      id: 'job_2',
      scope: 'product:product_1',
      status: 'running',
      productId: 'product_1',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    });

    const output = await service.getSyncStatus({} as CatalogSyncStatusQueryDto);

    expect(output.syncJobId).toBe('job_2');
    expect(output.summary.productId).toBe('product_1');
  });

  it('getSyncStatus should reject missing jobs', async () => {
    await expect(service.getSyncStatus({ syncJobId: 'missing' } as CatalogSyncStatusQueryDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('getSyncHealth should report mapped and missing variants', async () => {
    prisma.productMarketConfig.findMany.mockResolvedValue([
      {
        product: {
          variants: [{ id: 'variant_1' }, { id: 'variant_2' }],
        },
      },
      {
        product: {
          variants: [{ id: 'variant_3' }],
        },
      },
    ]);
    prisma.stripeProductPriceMap.findMany.mockResolvedValue([{ variantId: 'variant_1' }, { variantId: 'variant_3' }]);

    const output = await service.getSyncHealth({ market: 'br', currency: 'brl' } as CatalogSyncHealthQueryDto);

    expect(output).toEqual({
      market: 'BR',
      currency: 'BRL',
      totalExpected: 3,
      totalMapped: 2,
      gaps: ['variant_2'],
    });
  });

  it('getStripePriceMap should return the mapped stripe price', async () => {
    prisma.stripeProductPriceMap.findFirst.mockResolvedValue({
      stripeProductId: 'stripe_prod_1',
      stripePriceId: 'stripe_price_1',
      syncedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const output = await service.getStripePriceMap('product_1', 'variant_1', { currency: 'brl' } as StripePriceQueryDto);

    expect(output.stripePriceId).toBe('stripe_price_1');
  });

  it('getStripePriceMap should reject when mapping is missing', async () => {
    prisma.stripeProductPriceMap.findFirst.mockResolvedValue(null);

    await expect(service.getStripePriceMap('product_1', 'variant_1', { currency: 'brl' } as StripePriceQueryDto)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('receiveStripeWebhook should reject invalid signatures', async () => {
    await expect(
      service.receiveStripeWebhook(
        { eventId: 'evt_1', eventType: 'payment_intent.succeeded', payload: {} } as StripeWebhookDto,
        undefined,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('receiveStripeWebhook should persist a processed event', async () => {
    prisma.webhookEvent.create.mockResolvedValue({ id: 'wh_1' });

    const output = await service.receiveStripeWebhook(
      {
        eventId: 'evt_1',
        eventType: 'payment_intent.succeeded',
        correlationId: 'corr_1',
        payload: { id: 'pi_1' },
      } as StripeWebhookDto,
      'secret',
    );

    expect(output).toEqual({ received: true });
    expect(prisma.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: 'stripe',
          eventId: 'evt_1',
          eventType: 'payment_intent.succeeded',
          state: WebhookState.processed,
          correlationId: 'corr_1',
        }),
      }),
    );
  });

  it('receiveStripeWebhook should reject duplicate events', async () => {
    prisma.webhookEvent.create.mockRejectedValue({ code: 'P2002' });

    await expect(
      service.receiveStripeWebhook(
        {
          eventId: 'evt_1',
          eventType: 'payment_intent.succeeded',
          payload: { id: 'pi_1' },
        } as StripeWebhookDto,
        'secret',
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('listWebhookEvents should paginate stripe events', async () => {
    prisma.$transaction.mockResolvedValue([
      1,
      [{ id: 'evt_1', state: WebhookState.processed }],
    ]);

    const output = await service.listWebhookEvents({ state: WebhookState.processed, page: 1, perPage: 20 } as AdminWebhooksQueryDto);

    expect(prisma.webhookEvent.count).toHaveBeenCalledWith({
      where: { provider: 'stripe', state: WebhookState.processed },
    });
    expect(output.total).toBe(1);
    expect(output.items).toEqual([{ id: 'evt_1', state: WebhookState.processed }]);
  });

  it('listAdminSubscriptions should mask provider ids and paginate', async () => {
    prisma.$transaction.mockResolvedValue([
      1,
      [
        {
          id: 'sub_1',
          providerSubscriptionId: 'sub_test_12345678',
          status: SubscriptionStatus.active,
          autoRenew: true,
          nextBillingAt: new Date('2026-01-10T00:00:00.000Z'),
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          user: { id: 'user_1', email: 'john@example.com' },
          term: { marketCountry: 'BR', months: 3 },
        },
      ],
    ]);

    const output = await service.listAdminSubscriptions({ status: SubscriptionStatus.active, market: 'BR', page: 1, perPage: 20 } as AdminSubscriptionsQueryDto);

    expect(prisma.subscription.count).toHaveBeenCalledWith({
      where: { status: SubscriptionStatus.active, term: { marketCountry: 'BR' } },
    });
    expect(output.items[0].providerSubscriptionId).toContain('****');
  });
});
