const { HttpError } = require('../src/core/http-error');
const { SubscriptionsEditCommitService } = require('../src/services/subscriptions-edit-commit.service');

const validPayload = {
  subscription_term_months: 1,
  expected_current_hash: 'hash-current',
  pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
};

function buildService(overrides = {}) {
  const repository = overrides.repository || {
    commit: jest.fn().mockResolvedValue({
      subscription_id: 'sub_123',
      pending_webhook_confirmation: true,
      term_change: false,
      proration: { direction: 'none', amount_due_now: 0, credit_applied: 0, currency: 'USD' },
      payment_state: 'paid',
      stripe_client_secret: null,
      edit_payment_pending: false
    })
  };
  const authService = overrides.authService || {
    assertCriticalOperationAllowed: jest.fn().mockResolvedValue({ id: 7 })
  };
  const ledgerRepository = overrides.ledgerRepository || {
    findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue({
      stripeSubscriptionId: 'sub_123',
      userId: 7,
      status: 'active',
      editPaymentPending: false,
      subscriptionTermMonths: 1,
      petsSnapshot: { pet_ids: ['pet_1'] }
    }),
    listByUserId: jest.fn().mockResolvedValue([])
  };

  return {
    service: new SubscriptionsEditCommitService(repository, { authService, ledgerRepository }),
    repository,
    authService,
    ledgerRepository
  };
}

describe('SubscriptionsEditCommitService', () => {
  test('rejects commit without expected_current_hash', async () => {
    const { service, repository } = buildService();

    await expect(service.commit({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: { ...validPayload, expected_current_hash: '' }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'expected_current_hash_required' }
    });
    expect(repository.commit).not.toHaveBeenCalled();
  });

  test('returns 409 when the repository reports a stale hash', async () => {
    const { service } = buildService({
      repository: {
        commit: jest.fn().mockRejectedValue(new HttpError(409, 'Subscription state changed.', {
          code: 'subscription_state_changed'
        }))
      }
    });

    await expect(service.commit({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: validPayload
    })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'subscription_state_changed' }
    });
  });

  test('returns 403 when the account guard rejects', async () => {
    const { service, repository } = buildService({
      authService: {
        assertCriticalOperationAllowed: jest.fn().mockRejectedValue(new HttpError(403, 'blocked', {
          code: 'account_operation_not_allowed'
        }))
      }
    });

    await expect(service.commit({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: validPayload
    })).rejects.toMatchObject({ statusCode: 403 });
    expect(repository.commit).not.toHaveBeenCalled();
  });

  test('returns 404 for another user subscription', async () => {
    const { service, repository } = buildService({
      ledgerRepository: {
        findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(null),
        listByUserId: jest.fn()
      }
    });

    await expect(service.commit({
      userId: 7,
      subscriptionId: 'sub_other',
      payload: validPayload
    })).rejects.toMatchObject({
      statusCode: 404,
      details: { code: 'subscription_not_found' }
    });
    expect(repository.commit).not.toHaveBeenCalled();
  });
});
