const { HttpError } = require('../src/core/http-error');
const { SubscriptionsActionsRepository } = require('../src/infrastructure/repositories/subscriptions-actions.repository');

describe('SubscriptionsActionsRepository', () => {
  test('returns 404 when the subscription is not owned by the user', async () => {
    const repository = new SubscriptionsActionsRepository({
      ledgerRepository: { findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(null) },
      stripeBilling: { pauseSubscription: jest.fn() }
    });

    await expect(repository.executeAction(7, 'sub_other', { action: 'pause' })).rejects.toMatchObject({
      statusCode: 404,
      details: { code: 'subscription_not_found' }
    });
  });

  test('calls Stripe pause and returns pending_webhook_confirmation', async () => {
    const stripeBilling = { pauseSubscription: jest.fn().mockResolvedValue({ id: 'sub_123' }) };
    const row = {
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      status: 'active',
      planLabel: 'Plan #1',
      cancelAtPeriodEnd: false
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(row)
    };
    const repository = new SubscriptionsActionsRepository({ ledgerRepository, stripeBilling });

    const result = await repository.executeAction(7, 'sub_123', { action: 'pause' });

    expect(stripeBilling.pauseSubscription).toHaveBeenCalledWith('sub_123');
    expect(result.pending_webhook_confirmation).toBe(true);
    expect(result.subscription.subscription_id).toBe('sub_123');
  });

  test('propagates Stripe failures as 502', async () => {
    const repository = new SubscriptionsActionsRepository({
      ledgerRepository: {
        findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue({
          userId: 7,
          stripeSubscriptionId: 'sub_123',
          stripeCustomerId: 'cus_1',
          status: 'active'
        })
      },
      stripeBilling: {
        pauseSubscription: jest.fn().mockRejectedValue(new HttpError(502, 'down', { code: 'stripe_subscription_pause_failed' }))
      }
    });

    await expect(repository.executeAction(7, 'sub_123', { action: 'pause' })).rejects.toMatchObject({
      statusCode: 502
    });
  });
});
