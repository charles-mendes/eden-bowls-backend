import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, WebhookState } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { AdminSubscriptionsQueryDto } from './dto/admin-subscriptions-query.dto';
import { AdminWebhooksQueryDto } from './dto/admin-webhooks-query.dto';
import { CatalogSyncDto } from './dto/catalog-sync.dto';
import { CatalogSyncHealthQueryDto } from './dto/catalog-sync-health-query.dto';
import { CatalogSyncStatusQueryDto } from './dto/catalog-sync-status-query.dto';
import { StripePriceQueryDto } from './dto/stripe-price-query.dto';
import { StripeWebhookDto } from './dto/stripe-webhook.dto';

type SyncJobState = {
  id: string;
  scope: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  market?: string;
  currency?: string;
  productId?: string;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class PaymentsService {
  private readonly syncJobs = new Map<string, SyncJobState>();

  constructor(private readonly prisma: PrismaService) {}

  async syncCatalog(input: CatalogSyncDto) {
    const market = input.market.toUpperCase();
    const currency = input.currency.toUpperCase();

    const running = Array.from(this.syncJobs.values()).find(
      (job) =>
        job.scope === `market:${market}:currency:${currency}` &&
        (job.status === 'queued' || job.status === 'running'),
    );

    if (running) {
      throw new ConflictException('sync_already_running');
    }

    const job = this.createSyncJob({
      scope: `market:${market}:currency:${currency}`,
      market,
      currency,
    });

    return {
      syncJobId: job.id,
      status: job.status,
    };
  }

  async syncCatalogProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true },
    });

    if (!product) {
      throw new NotFoundException('product_not_found');
    }

    const running = Array.from(this.syncJobs.values()).find(
      (job) =>
        job.scope === `product:${productId}` &&
        (job.status === 'queued' || job.status === 'running'),
    );

    if (running) {
      throw new ConflictException('sync_already_running');
    }

    const job = this.createSyncJob({
      scope: `product:${productId}`,
      productId,
    });

    return {
      syncJobId: job.id,
      status: job.status,
    };
  }

  async getSyncStatus(query: CatalogSyncStatusQueryDto) {
    if (!query.syncJobId) {
      const latest = Array.from(this.syncJobs.values()).sort(
        (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime(),
      )[0];

      if (!latest) {
        throw new NotFoundException('sync_job_not_found');
      }

      return this.toSyncStatus(latest);
    }

    const job = this.syncJobs.get(query.syncJobId);
    if (!job) {
      throw new NotFoundException('sync_job_not_found');
    }

    return this.toSyncStatus(job);
  }

  async getSyncHealth(query: CatalogSyncHealthQueryDto) {
    const market = query.market.toUpperCase();
    const currency = query.currency.toUpperCase();

    const variantIds = await this.prisma.productMarketConfig.findMany({
      where: {
        marketCountry: market,
        currency,
        active: true,
        product: { active: true },
      },
      select: {
        product: {
          select: {
            variants: {
              where: { active: true },
              select: { id: true },
            },
          },
        },
      },
    });

    const expectedVariantIds = new Set(
      variantIds.flatMap((item) => item.product.variants.map((v) => v.id)),
    );

    const mapped = await this.prisma.stripeProductPriceMap.findMany({
      where: {
        currency,
        variantId: {
          in: Array.from(expectedVariantIds),
        },
      },
      select: {
        variantId: true,
      },
    });

    const mappedSet = new Set(mapped.map((item) => item.variantId));

    const missing = Array.from(expectedVariantIds).filter(
      (variantId) => !mappedSet.has(variantId),
    );

    return {
      market,
      currency,
      totalExpected: expectedVariantIds.size,
      totalMapped: mappedSet.size,
      gaps: missing,
    };
  }

  async getStripePriceMap(
    productId: string,
    variantId: string,
    query: StripePriceQueryDto,
  ) {
    const currency = query.currency.toUpperCase();

    const map = await this.prisma.stripeProductPriceMap.findFirst({
      where: {
        variantId,
        currency,
        variant: {
          productId,
        },
      },
      select: {
        stripeProductId: true,
        stripePriceId: true,
        syncedAt: true,
      },
    });

    if (!map) {
      throw new NotFoundException('stripe_mapping_not_found');
    }

    return map;
  }

  async receiveStripeWebhook(
    body: StripeWebhookDto,
    stripeSignature: string | undefined,
  ) {
    this.validateWebhookSignature(body, stripeSignature);

    const payloadHash = createHash('sha256')
      .update(JSON.stringify(body.payload))
      .digest('hex');

    try {
      await this.prisma.webhookEvent.create({
        data: {
          provider: 'stripe',
          eventId: body.eventId,
          eventType: body.eventType,
          payloadHash,
          state: WebhookState.processed,
          attempts: 1,
          correlationId: body.correlationId,
          payloadJson: body.payload as Prisma.InputJsonValue,
          processedAt: new Date(),
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        throw new ConflictException('duplicate_event');
      }
      throw error;
    }

    return {
      received: true,
    };
  }

  async listWebhookEvents(query: AdminWebhooksQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.WebhookEventWhereInput = {
      provider: 'stripe',
      ...(query.state ? { state: query.state } : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.webhookEvent.count({ where }),
      this.prisma.webhookEvent.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      total,
      page,
      perPage,
      items,
    };
  }

  async listAdminSubscriptions(query: AdminSubscriptionsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const skip = (page - 1) * perPage;

    const where: Prisma.SubscriptionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.market
        ? {
            term: {
              marketCountry: query.market.toUpperCase(),
            },
          }
        : {}),
    };

    const [total, items] = await this.prisma.$transaction([
      this.prisma.subscription.count({ where }),
      this.prisma.subscription.findMany({
        where,
        skip,
        take: perPage,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          term: {
            select: {
              marketCountry: true,
              months: true,
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
        providerSubscriptionId: this.maskProviderId(item.providerSubscriptionId),
        status: item.status,
        autoRenew: item.autoRenew,
        nextBillingAt: item.nextBillingAt,
        createdAt: item.createdAt,
        user: item.user,
        term: item.term,
      })),
    };
  }

  private createSyncJob(input: {
    scope: string;
    market?: string;
    currency?: string;
    productId?: string;
  }): SyncJobState {
    const now = new Date();
    const id = randomUUID();

    const job: SyncJobState = {
      id,
      scope: input.scope,
      status: 'running',
      market: input.market,
      currency: input.currency,
      productId: input.productId,
      createdAt: now,
      updatedAt: now,
    };

    this.syncJobs.set(id, job);

    job.status = 'completed';
    job.updatedAt = new Date();

    return job;
  }

  private toSyncStatus(job: SyncJobState) {
    return {
      syncJobId: job.id,
      status: job.status,
      summary: {
        scope: job.scope,
        market: job.market,
        currency: job.currency,
        productId: job.productId,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    };
  }

  private validateWebhookSignature(
    body: StripeWebhookDto,
    stripeSignature: string | undefined,
  ) {
    if (!stripeSignature) {
      throw new BadRequestException('invalid_signature');
    }

    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (secret && stripeSignature !== secret) {
      throw new BadRequestException('invalid_signature');
    }

    if (!body.eventId || !body.eventType) {
      throw new BadRequestException('invalid_signature');
    }
  }

  private isUniqueViolation(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'P2002'
    );
  }

  private maskProviderId(value: string) {
    if (value.length <= 8) {
      return '****';
    }
    return `${value.slice(0, 4)}****${value.slice(-4)}`;
  }
}
