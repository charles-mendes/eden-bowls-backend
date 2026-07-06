import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CheckoutOrderStatus, OrderStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutRequestDto } from './dto/create-checkout-request.dto';
import { PaymentIntentAckDto } from './dto/payment-intent-ack.dto';

@Injectable()
export class CheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async createCheckoutOrder(
    sessionId: string,
    idempotencyKey: string | undefined,
    input: CreateCheckoutRequestDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('idempotency_key_required');
    }

    const requestHash = this.hashPayload(input);

    const session = await this.prisma.onboardingSession.findUnique({
      where: { id: sessionId },
      include: {
        sessionPets: {
          orderBy: { sortOrder: 'asc' },
          include: {
            pet: true,
          },
        },
        recommendationRuns: {
          orderBy: { createdAt: 'desc' },
          include: {
            planSnapshots: {
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!session) {
      throw new NotFoundException('onboarding_session_not_found');
    }

    if (!session.linkedUserId) {
      throw new ForbiddenException('account_link_required');
    }

    const existingKey = await this.prisma.idempotencyKey.findUnique({
      where: {
        scope_key: {
          scope: this.scopeForSession(sessionId),
          key: idempotencyKey,
        },
      },
    });

    if (existingKey) {
      if (existingKey.requestHash !== requestHash) {
        throw new ConflictException('idempotency_conflict');
      }

      if (existingKey.responseJson) {
        return existingKey.responseJson as Prisma.JsonObject;
      }
    }

    const snapshot = await this.prisma.planSnapshot.findFirst({
      where: { snapshotHash: input.snapshotHash },
      include: {
        run: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!snapshot || snapshot.run.sessionId !== sessionId) {
      throw new ConflictException('snapshot_mismatch');
    }

    const shippingQuote = await this.prisma.shippingQuote.findFirst({
      where: {
        id: input.selectedShipping.quoteId,
        sessionId,
      },
      include: {
        rates: {
          where: { id: input.selectedShipping.rateId },
          take: 1,
        },
      },
    });

    if (!shippingQuote) {
      throw new ConflictException('quote_expired');
    }

    if (shippingQuote.expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('quote_expired');
    }

    if (shippingQuote.selectedRateId !== input.selectedShipping.rateId) {
      throw new ConflictException('quote_expired');
    }

    const selectedRate = shippingQuote.rates[0];
    if (!selectedRate) {
      throw new ConflictException('quote_expired');
    }

    const { product, unitPrice } = await this.resolvePlanItem(snapshot.currency, session.country);

    const paymentIntentRef = `pi_${randomUUID()}`;

    const checkoutOrder = await this.prisma.$transaction(async (tx) => {
      const metadataJson: Prisma.InputJsonValue = {
        paymentIntentRef,
        snapshotHash: snapshot.snapshotHash,
        billingAddress: {
          country: input.billingAddress.country,
          state: input.billingAddress.state,
          city: input.billingAddress.city,
          postcode: input.billingAddress.postcode,
          address1: input.billingAddress.address1,
          address2: input.billingAddress.address2 ?? null,
        },
        selectedShipping: {
          quoteId: input.selectedShipping.quoteId,
          rateId: input.selectedShipping.rateId,
        },
        requestHash,
        createdBy: session.linkedUserId,
      };

      const created = await tx.checkoutOrder.create({
        data: {
          sessionId,
          userId: session.linkedUserId!,
          planSnapshotId: snapshot.id,
          status: CheckoutOrderStatus.pending_payment,
          currency: snapshot.currency,
          subtotal: snapshot.subtotalAmount,
          shippingTotal: selectedRate.amount,
          total: snapshot.totalAmount,
          paymentState: 'requires_confirmation',
          metadataJson,
          items: {
            create: session.sessionPets.map((item, index) => ({
              productId: product.id,
              variantId: product.variantId,
              quantity: 1,
              unitPrice: new Prisma.Decimal(unitPrice.toFixed(2)),
              lineTotal: new Prisma.Decimal(unitPrice.toFixed(2)),
              payloadJson: {
                petId: item.petId,
                petName: item.pet.name,
                recommendationRunId: snapshot.runId,
                snapshotHash: snapshot.snapshotHash,
                sortOrder: index + 1,
              } as Prisma.InputJsonValue,
            })),
          },
          shippingSelection: {
            create: {
              quoteId: shippingQuote.id,
              rateId: selectedRate.id,
              label: selectedRate.serviceLabel,
              cost: selectedRate.amount,
              taxTotal: new Prisma.Decimal(0),
              total: selectedRate.amount,
              rawJson: {
                quoteId: shippingQuote.id,
                rateId: selectedRate.id,
                provider: shippingQuote.provider,
              } as Prisma.InputJsonValue,
            },
          },
        },
      });

      const response = {
        checkoutOrderId: created.id,
        paymentIntentRef,
        status: created.status,
      };

      await tx.idempotencyKey.create({
        data: {
          scope: this.scopeForSession(sessionId),
          key: idempotencyKey,
          requestHash,
          responseJson: response as Prisma.InputJsonValue,
          statusCode: 201,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      return response;
    });

    return checkoutOrder;
  }

  async acknowledgePaymentIntent(
    sessionId: string,
    input: PaymentIntentAckDto,
  ) {
    const order = await this.findCheckoutOrderByPaymentIntent(sessionId, input.paymentIntentId);

    if (!order) {
      throw new NotFoundException('checkout_order_not_found');
    }

    if (!this.canTransitionPaymentState(order.paymentState, input.status)) {
      throw new ConflictException('invalid_payment_transition');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const nextPaymentState = input.status;
      const nextStatus = input.status === 'succeeded'
        ? CheckoutOrderStatus.paid
        : input.status === 'failed'
          ? CheckoutOrderStatus.failed
          : CheckoutOrderStatus.pending_payment;

      const orderUpdate = await tx.checkoutOrder.update({
        where: { id: order.id },
        data: {
          paymentState: nextPaymentState,
          status: nextStatus,
        },
      });

      if (input.status === 'succeeded' && !order.orders.length) {
        await tx.order.create({
          data: {
            checkoutOrderId: order.id,
            userId: order.userId,
            status: OrderStatus.confirmed,
          },
        });
      }

      return orderUpdate;
    });

    return {
      paymentState: updated.paymentState,
    };
  }

  private async findCheckoutOrderByPaymentIntent(sessionId: string, paymentIntentId: string) {
    const orders = await this.prisma.checkoutOrder.findMany({
      where: { sessionId },
      include: { orders: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.find((item) => {
      const metadata = item.metadataJson as Record<string, unknown> | null;
      return metadata?.paymentIntentRef === paymentIntentId;
    });
  }

  private async resolvePlanItem(currency: string, marketCountry: string) {
    const planProducts = await this.prisma.productMarketConfig.findMany({
      where: {
        marketCountry,
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

    let best: { productId: string; variantId: string; amount: number } | null = null;
    const now = new Date();

    for (const item of planProducts) {
      for (const variant of item.product.variants) {
        const price = variant.variantPrices[0];
        if (!price) {
          continue;
        }

        const effectiveAmount = this.resolvePriceAmount(price, now);
        if (effectiveAmount === null) {
          continue;
        }

        if (!best || effectiveAmount < best.amount) {
          best = {
            productId: item.product.id,
            variantId: variant.id,
            amount: effectiveAmount,
          };
        }
      }
    }

    if (!best) {
      throw new NotFoundException('no_active_plan_price');
    }

    return {
      product: {
        id: best.productId,
        variantId: best.variantId,
      },
      unitPrice: best.amount,
    };
  }

  private resolvePriceAmount(
    price: {
      regularPrice: Prisma.Decimal;
      salePrice: Prisma.Decimal | null;
      saleFrom: Date | null;
      saleTo: Date | null;
    },
    now: Date,
  ) {
    if (
      price.salePrice &&
      (!price.saleFrom || price.saleFrom <= now) &&
      (!price.saleTo || price.saleTo >= now)
    ) {
      return Number(price.salePrice);
    }

    return Number(price.regularPrice);
  }

  private canTransitionPaymentState(from: string, to: 'processing' | 'succeeded' | 'failed') {
    if (from === to) {
      return true;
    }

    const allowed: Record<string, Array<'processing' | 'succeeded' | 'failed'>> = {
      requires_confirmation: ['processing', 'succeeded', 'failed'],
      processing: ['succeeded', 'failed'],
      succeeded: [],
      failed: [],
    };

    return (allowed[from] ?? []).includes(to);
  }

  private scopeForSession(sessionId: string) {
    return `checkout:create:${sessionId}`;
  }

  private hashPayload(input: unknown) {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }
}
