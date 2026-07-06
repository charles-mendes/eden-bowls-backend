import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';

import { SubscriptionsService } from './subscriptions.service';
import { EffectiveMode, ProrationMode } from './dto/subscription-action.dto';
import { SubscriptionActionType } from './dto/subscription-action.dto';
import { SubscriptionPatchAction } from './dto/update-subscription.dto';

type PrismaMock = {
  idempotencyKey: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
  subscriptionTerm: {
    findUnique: jest.Mock;
  };
  subscription: {
    create: jest.Mock;
    findUnique: jest.Mock;
    findMany: jest.Mock;
    update: jest.Mock;
  };
  subscriptionItem: {
    create: jest.Mock;
  };
  subscriptionEvent: {
    create: jest.Mock;
  };
  productVariant: {
    findUnique: jest.Mock;
  };
  $transaction: jest.Mock;
};

const makePrismaMock = (): PrismaMock => ({
  idempotencyKey: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  subscriptionTerm: {
    findUnique: jest.fn(),
  },
  subscription: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  subscriptionItem: {
    create: jest.fn(),
  },
  subscriptionEvent: {
    create: jest.fn(),
  },
  productVariant: {
    findUnique: jest.fn(),
  },
  $transaction: jest.fn(),
});

describe('SubscriptionsService', () => {
  let prisma: PrismaMock;
  let service: SubscriptionsService;

  beforeEach(() => {
    prisma = makePrismaMock();
    service = new SubscriptionsService(prisma as never);
  });

  it('createSubscription should create a subscription and persist idempotency', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.subscriptionTerm.findUnique.mockResolvedValue({ id: 'term_1', active: true });
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        subscription: {
          create: jest.fn().mockResolvedValue({ id: 'sub_1', providerSubscriptionId: 'provider_1', status: SubscriptionStatus.active }),
        },
        productVariant: {
          findUnique: jest.fn().mockResolvedValue({ id: 'variant_1' }),
        },
        subscriptionItem: {
          create: jest.fn(),
        },
        subscriptionEvent: {
          create: jest.fn(),
        },
        idempotencyKey: {
          upsert: jest.fn(),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.createSubscription(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'idem-12345',
      {
        checkoutOrderId: 'checkout_1',
        paymentMethodId: 'pm_1',
        termId: 'term_1',
        providerSubscriptionId: 'provider_1',
        items: [{ variantId: 'variant_1', quantity: 2, unitPrice: 25 }],
        recurrenceJson: JSON.stringify({ frequency: 'monthly' }),
        planSnapshotJson: JSON.stringify({ snapshotHash: 'snap_1' }),
      },
    );

    expect(output).toEqual({
      subscriptionId: 'sub_1',
      providerSubscriptionId: 'provider_1',
      status: SubscriptionStatus.active,
    });
  });

  it('createSubscription should throw on conflicting idempotency payload', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'different' });

    await expect(
      service.createSubscription(
        { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
        'idem-12345',
        {
          paymentMethodId: 'pm_1',
          termId: 'term_1',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('createSubscription should reject inactive terms', async () => {
    prisma.idempotencyKey.findUnique.mockResolvedValue(null);
    prisma.subscriptionTerm.findUnique.mockResolvedValue({ id: 'term_1', active: false });

    await expect(
      service.createSubscription(
        { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
        'idem-12345',
        {
          paymentMethodId: 'pm_1',
          termId: 'term_1',
        },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('listSubscriptions should return only actor subscriptions', async () => {
    prisma.subscription.findMany.mockResolvedValue([{ id: 'sub_1' }]);

    const output = await service.listSubscriptions(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      {},
    );

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1' },
      }),
    );
    expect(output).toEqual([{ id: 'sub_1' }]);
  });

  it('getSubscription should reject access for other customers', async () => {
    prisma.subscription.findUnique.mockResolvedValue({ id: 'sub_1', userId: 'user_2' });

    await expect(
      service.getSubscription(
        { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
        'sub_1',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('patchSubscription should cancel subscription and emit event', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      status: SubscriptionStatus.active,
      termId: 'term_1',
    });
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        subscription: {
          update: jest.fn().mockResolvedValue({ id: 'sub_1', status: SubscriptionStatus.cancelled }),
        },
        subscriptionEvent: {
          create: jest.fn().mockResolvedValue({ id: 'event_1' }),
        },
        subscriptionTerm: {
          findUnique: jest.fn(),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.patchSubscription(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'sub_1',
      { action: SubscriptionPatchAction.cancel },
    );

    expect(output.status).toBe(SubscriptionStatus.cancelled);
  });

  it('executeAction should schedule next renewal action', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      status: SubscriptionStatus.active,
    });

    const output = await service.executeAction(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'sub_1',
      {
        actionType: SubscriptionActionType.pause,
        effectiveMode: EffectiveMode.next_renewal,
        prorationMode: ProrationMode.none,
      },
    );

    expect(output).toEqual({
      actionResult: 'scheduled',
      effectiveMode: EffectiveMode.next_renewal,
      prorationMode: ProrationMode.none,
    });
  });

  it('executeAction should apply immediate action', async () => {
    prisma.subscription.findUnique.mockResolvedValue({
      id: 'sub_1',
      userId: 'user_1',
      status: SubscriptionStatus.active,
    });
    prisma.subscriptionTerm.findUnique.mockResolvedValue({ id: 'term_1', active: true });
    prisma.$transaction.mockImplementation(async (callback: (tx: PrismaMock) => Promise<unknown>) => {
      const tx = {
        subscription: {
          update: jest.fn().mockResolvedValue({ id: 'sub_1', status: SubscriptionStatus.paused }),
        },
        subscriptionEvent: {
          create: jest.fn().mockResolvedValue({ id: 'event_1' }),
        },
      } as unknown as PrismaMock;
      return callback(tx);
    });

    const output = await service.executeAction(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'sub_1',
      {
        actionType: SubscriptionActionType.pause,
        effectiveMode: EffectiveMode.immediate,
        prorationMode: ProrationMode.prorated,
      },
    );

    expect(output.status).toBe(SubscriptionStatus.paused);
  });
});
