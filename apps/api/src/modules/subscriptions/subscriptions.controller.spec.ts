import { SubscriptionStatus } from '@prisma/client';

import { SubscriptionsController } from './subscriptions.controller';
import { EffectiveMode, ProrationMode } from './dto/subscription-action.dto';
import { SubscriptionActionType } from './dto/subscription-action.dto';
import { SubscriptionPatchAction } from './dto/update-subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

describe('SubscriptionsController', () => {
  let service: {
    createSubscription: jest.Mock;
    listSubscriptions: jest.Mock;
    getSubscription: jest.Mock;
    patchSubscription: jest.Mock;
    executeAction: jest.Mock;
  };
  let controller: SubscriptionsController;

  beforeEach(() => {
    service = {
      createSubscription: jest.fn(),
      listSubscriptions: jest.fn(),
      getSubscription: jest.fn(),
      patchSubscription: jest.fn(),
      executeAction: jest.fn(),
    };
    controller = new SubscriptionsController(service as unknown as SubscriptionsService);
  });

  it('createSubscription should delegate to service', async () => {
    service.createSubscription.mockResolvedValue({ subscriptionId: 'sub_1' });

    const output = await controller.createSubscription(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'idem-12345',
      { paymentMethodId: 'pm_1', termId: 'term_1' },
    );

    expect(service.createSubscription).toHaveBeenCalled();
    expect(output).toEqual({ subscriptionId: 'sub_1' });
  });

  it('listSubscriptions should delegate to service', async () => {
    service.listSubscriptions.mockResolvedValue([{ id: 'sub_1' }]);

    const output = await controller.listSubscriptions(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      {},
    );

    expect(service.listSubscriptions).toHaveBeenCalled();
    expect(output).toEqual([{ id: 'sub_1' }]);
  });

  it('getSubscription should delegate to service', async () => {
    service.getSubscription.mockResolvedValue({ id: 'sub_1' });

    const output = await controller.getSubscription(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'sub_1',
    );

    expect(service.getSubscription).toHaveBeenCalledWith(
      { userId: 'user_1', email: 'john@example.com', roles: ['customer'], permissions: [] },
      'sub_1',
    );
    expect(output).toEqual({ id: 'sub_1' });
  });

  it('patchSubscription should delegate to service', async () => {
    service.patchSubscription.mockResolvedValue({ id: 'sub_1', status: SubscriptionStatus.cancelled });

    const output = await controller.patchSubscription(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'sub_1',
      { action: SubscriptionPatchAction.cancel },
    );

    expect(service.patchSubscription).toHaveBeenCalled();
    expect(output).toEqual({ id: 'sub_1', status: SubscriptionStatus.cancelled });
  });

  it('executeAction should delegate to service', async () => {
    service.executeAction.mockResolvedValue({
      actionResult: 'scheduled',
      effectiveMode: EffectiveMode.next_renewal,
      prorationMode: ProrationMode.none,
    });

    const output = await controller.executeAction(
      { userId: 'admin_1', email: 'admin@example.com', roles: ['admin'], permissions: [] },
      'sub_1',
      {
        actionType: SubscriptionActionType.pause,
        effectiveMode: EffectiveMode.next_renewal,
        prorationMode: ProrationMode.none,
      },
    );

    expect(service.executeAction).toHaveBeenCalled();
    expect(output).toEqual({
      actionResult: 'scheduled',
      effectiveMode: EffectiveMode.next_renewal,
      prorationMode: ProrationMode.none,
    });
  });
});
