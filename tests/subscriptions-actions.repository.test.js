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

describe('SubscriptionsActionsRepository automatic renewal', () => {
  function build(rowOverrides = {}, invoices = []) {
    const row = {
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      status: 'active',
      cancelAtPeriodEnd: false,
      autoRenew: true,
      subscriptionTermMonths: 3,
      chargedDeliveries: 1,
      ...rowOverrides
    };
    const stripeBilling = {
      setCancelAtPeriodEnd: jest.fn().mockResolvedValue({}),
      listPaidInvoicesForSubscription: jest.fn().mockResolvedValue(invoices)
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(row),
      setAutoRenew: jest.fn().mockResolvedValue(row)
    };
    return { repository: new SubscriptionsActionsRepository({ ledgerRepository, stripeBilling }), stripeBilling, ledgerRepository };
  }

  test('turning renewal off mid contract saves the choice and leaves cancel_at_period_end off', async () => {
    const { repository, stripeBilling, ledgerRepository } = build();
    await repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: false });
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', false);
    expect(ledgerRepository.setAutoRenew).toHaveBeenCalledWith('sub_123', false);
    expect(stripeBilling.listPaidInvoicesForSubscription).not.toHaveBeenCalled();
  });

  test('turning renewal off after the last contracted delivery was charged ends the plan at this period', async () => {
    const { repository, stripeBilling, ledgerRepository } = build({ chargedDeliveries: 3 });
    await repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: false });
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', true);
    expect(ledgerRepository.setAutoRenew).toHaveBeenCalledWith('sub_123', false);
  });

  test('turning renewal on clears cancel_at_period_end', async () => {
    const { repository, stripeBilling, ledgerRepository } = build({ autoRenew: false, cancelAtPeriodEnd: true, chargedDeliveries: 3 });
    await repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew' });
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', false);
    expect(ledgerRepository.setAutoRenew).toHaveBeenCalledWith('sub_123', true);
  });

  test('without a ledger count it counts paid cycle invoices on Stripe, not prorations', async () => {
    const { repository, stripeBilling } = build({ chargedDeliveries: null }, [
      { status: 'paid', billing_reason: 'subscription_create', amount_paid: 9600 },
      { status: 'paid', billing_reason: 'subscription_cycle', amount_paid: 9600 },
      { status: 'paid', billing_reason: 'subscription_update', amount_paid: 3200 }
    ]);
    await repository.executeAction(7, 'sub_123', { action: 'toggle_auto_renew', enabled: false });
    expect(stripeBilling.listPaidInvoicesForSubscription).toHaveBeenCalledWith('sub_123');
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', false);
  });
});
