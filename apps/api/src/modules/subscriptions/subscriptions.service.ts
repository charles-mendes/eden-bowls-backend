import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SubscriptionEventSource,
  SubscriptionStatus,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';

import { AuthUser } from '../auth/types/auth-user.type';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { ListSubscriptionsQueryDto } from './dto/list-subscriptions-query.dto';
import {
  EffectiveMode,
  SubscriptionActionDto,
  SubscriptionActionType,
} from './dto/subscription-action.dto';
import {
  SubscriptionPatchAction,
  UpdateSubscriptionDto,
} from './dto/update-subscription.dto';

@Injectable()
export class SubscriptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async createSubscription(
    actor: AuthUser,
    idempotencyKey: string | undefined,
    input: CreateSubscriptionDto,
  ) {
    if (!idempotencyKey || idempotencyKey.trim().length < 8) {
      throw new BadRequestException('Idempotency-Key header is required');
    }

    const requestHash = this.hashRequest(actor.userId, input);
    const scope = 'billing:create_subscription';

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: {
        scope_key: {
          scope,
          key: idempotencyKey,
        },
      },
    });

    if (existing && existing.requestHash !== requestHash) {
      throw new ConflictException('idempotency_conflict');
    }

    if (existing?.responseJson) {
      return existing.responseJson;
    }

    const term = await this.prisma.subscriptionTerm.findUnique({
      where: { id: input.termId },
      select: {
        id: true,
        active: true,
      },
    });

    if (!term || !term.active) {
      throw new ConflictException('checkout_not_eligible');
    }

    const parsedRecurrence = this.parseJsonObject(input.recurrenceJson, {
      frequency: 'monthly',
    });
    const parsedSnapshot = this.parseJsonObject(input.planSnapshotJson, {
      checkoutOrderId: input.checkoutOrderId ?? null,
      paymentMethodId: input.paymentMethodId,
    });

    const providerSubscriptionId =
      input.providerSubscriptionId ?? `sub_${randomUUID().replace(/-/g, '')}`;

    const result = await this.prisma.$transaction(async (tx) => {
      const subscription = await tx.subscription.create({
        data: {
          userId: actor.userId,
          orderId: input.checkoutOrderId,
          provider: 'stripe',
          providerSubscriptionId,
          status: SubscriptionStatus.active,
          autoRenew: true,
          termId: input.termId,
          startAt: new Date(),
          recurrenceJson: parsedRecurrence as Prisma.InputJsonValue,
          planSnapshotJson: parsedSnapshot as Prisma.InputJsonValue,
        },
        select: {
          id: true,
          providerSubscriptionId: true,
          status: true,
        },
      });

      for (const item of input.items ?? []) {
        const variant = await tx.productVariant.findUnique({
          where: { id: item.variantId },
          select: { id: true },
        });

        if (!variant) {
          throw new NotFoundException(`Variant not found: ${item.variantId}`);
        }

        await tx.subscriptionItem.create({
          data: {
            subscriptionId: subscription.id,
            variantId: item.variantId,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            lineTotal: new Prisma.Decimal(item.unitPrice * item.quantity),
          },
        });
      }

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          source: SubscriptionEventSource.api,
          eventType: 'subscription.created',
          payloadJson: {
            paymentMethodId: input.paymentMethodId,
          },
        },
      });

      const payload = {
        subscriptionId: subscription.id,
        providerSubscriptionId: subscription.providerSubscriptionId,
        status: subscription.status,
      };

      await tx.idempotencyKey.upsert({
        where: {
          scope_key: {
            scope,
            key: idempotencyKey,
          },
        },
        update: {
          requestHash,
          responseJson: payload as Prisma.InputJsonValue,
          statusCode: 200,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
        create: {
          scope,
          key: idempotencyKey,
          requestHash,
          responseJson: payload as Prisma.InputJsonValue,
          statusCode: 200,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });

      return payload;
    });

    return result;
  }

  async listSubscriptions(actor: AuthUser, query: ListSubscriptionsQueryDto) {
    return this.prisma.subscription.findMany({
      where: {
        userId: actor.userId,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        providerSubscriptionId: true,
        status: true,
        autoRenew: true,
        startAt: true,
        endAt: true,
        nextBillingAt: true,
        nextShipmentAt: true,
        createdAt: true,
      },
    });
  }

  async getSubscription(actor: AuthUser, subscriptionId: string) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        items: true,
        events: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!subscription) {
      throw new NotFoundException('subscription_not_found');
    }

    if (!this.canAccess(actor, subscription.userId)) {
      throw new ForbiddenException('forbidden');
    }

    return subscription;
  }

  async patchSubscription(
    actor: AuthUser,
    subscriptionId: string,
    input: UpdateSubscriptionDto,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        userId: true,
        status: true,
        termId: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('subscription_not_found');
    }

    if (!this.canManage(actor, subscription.userId)) {
      throw new ForbiddenException('forbidden');
    }

    const updateData: Prisma.SubscriptionUpdateInput = {};

    if (input.action === SubscriptionPatchAction.swap) {
      if (!input.termId) {
        throw new BadRequestException('invalid_action_payload');
      }

      const term = await this.prisma.subscriptionTerm.findUnique({
        where: { id: input.termId },
        select: { id: true, active: true },
      });

      if (!term || !term.active) {
        throw new BadRequestException('invalid_action_payload');
      }

      updateData.term = { connect: { id: input.termId } };
    } else {
      const nextStatus = this.resolveTransition(subscription.status, input.action);
      updateData.status = nextStatus;

      if (nextStatus === SubscriptionStatus.cancelled) {
        updateData.endAt = new Date();
        updateData.autoRenew = false;
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscription.id },
        data: updateData,
      });

      await tx.subscriptionEvent.create({
        data: {
          subscriptionId: subscription.id,
          source: SubscriptionEventSource.api,
          eventType: `subscription.${input.action}`,
          payloadJson: {
            actorUserId: actor.userId,
            action: input.action,
            payload: (input.payload ?? null) as Prisma.InputJsonValue | null,
            termId: input.termId ?? null,
          } as Prisma.InputJsonValue,
        },
      });

      return result;
    });

    return updated;
  }

  async executeAction(
    actor: AuthUser,
    subscriptionId: string,
    input: SubscriptionActionDto,
  ) {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: {
        id: true,
        userId: true,
        status: true,
      },
    });

    if (!subscription) {
      throw new NotFoundException('subscription_not_found');
    }

    if (!this.canManage(actor, subscription.userId)) {
      throw new ForbiddenException('forbidden');
    }

    if (input.effectiveMode === EffectiveMode.next_renewal) {
      await this.prisma.subscriptionEvent.create({
        data: {
          subscriptionId,
          source: SubscriptionEventSource.api,
          eventType: `subscription.action_scheduled.${input.actionType}`,
          payloadJson: {
            actorUserId: actor.userId,
            effectiveMode: input.effectiveMode,
            prorationMode: input.prorationMode,
          },
        },
      });

      return {
        actionResult: 'scheduled',
        effectiveMode: input.effectiveMode,
        prorationMode: input.prorationMode,
      };
    }

    if (input.actionType === SubscriptionActionType.swap) {
      throw new BadRequestException('unsupported_action');
    }

    const actionToPatch = this.actionTypeToPatch(input.actionType);
    const updated = await this.patchSubscription(actor, subscriptionId, {
      action: actionToPatch,
    });

    await this.prisma.subscriptionEvent.create({
      data: {
        subscriptionId,
        source: SubscriptionEventSource.api,
        eventType: `subscription.action_applied.${input.actionType}`,
        payloadJson: {
          actorUserId: actor.userId,
          effectiveMode: input.effectiveMode,
          prorationMode: input.prorationMode,
        },
      },
    });

    return {
      actionResult: 'applied',
      subscriptionId: updated.id,
      status: updated.status,
    };
  }

  private canAccess(actor: AuthUser, ownerUserId: string) {
    return actor.userId === ownerUserId || this.isPrivileged(actor);
  }

  private canManage(actor: AuthUser, ownerUserId: string) {
    return actor.userId === ownerUserId || this.isPrivileged(actor);
  }

  private isPrivileged(actor: AuthUser) {
    return actor.roles.some((role) => role === 'admin' || role === 'operator');
  }

  private resolveTransition(
    current: SubscriptionStatus,
    action: SubscriptionPatchAction,
  ): SubscriptionStatus {
    const valid: Record<SubscriptionStatus, SubscriptionPatchAction[]> = {
      active: [
        SubscriptionPatchAction.pause,
        SubscriptionPatchAction.cancel,
        SubscriptionPatchAction.swap,
      ],
      paused: [
        SubscriptionPatchAction.resume,
        SubscriptionPatchAction.cancel,
        SubscriptionPatchAction.swap,
      ],
      past_due: [SubscriptionPatchAction.resume, SubscriptionPatchAction.cancel],
      cancelled: [],
    };

    if (!valid[current].includes(action)) {
      throw new ConflictException('invalid_subscription_transition');
    }

    switch (action) {
      case SubscriptionPatchAction.pause:
        return SubscriptionStatus.paused;
      case SubscriptionPatchAction.resume:
        return SubscriptionStatus.active;
      case SubscriptionPatchAction.cancel:
        return SubscriptionStatus.cancelled;
      case SubscriptionPatchAction.swap:
        return current;
      default:
        return current;
    }
  }

  private actionTypeToPatch(
    actionType: SubscriptionActionType,
  ): SubscriptionPatchAction {
    switch (actionType) {
      case SubscriptionActionType.pause:
        return SubscriptionPatchAction.pause;
      case SubscriptionActionType.resume:
        return SubscriptionPatchAction.resume;
      case SubscriptionActionType.cancel:
        return SubscriptionPatchAction.cancel;
      case SubscriptionActionType.swap:
        return SubscriptionPatchAction.swap;
      default:
        return SubscriptionPatchAction.pause;
    }
  }

  private parseJsonObject(input: string | undefined, fallback: object) {
    if (!input) {
      return fallback;
    }

    try {
      const parsed = JSON.parse(input);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('invalid json object');
      }
      return parsed;
    } catch {
      throw new BadRequestException('invalid json payload');
    }
  }

  private hashRequest(userId: string, input: CreateSubscriptionDto) {
    return createHash('sha256')
      .update(JSON.stringify({ userId, input }))
      .digest('hex');
  }
}
