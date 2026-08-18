const { SubscriptionsEditCommitRepository } = require('../src/infrastructure/repositories/subscriptions-edit-commit.repository');
const { buildCurrentHash } = require('../src/core/subscription-edit-hash');

describe('SubscriptionsEditCommitRepository', () => {
  const currentItems = [{ id: 'si_1', price: 'price_abc', quantity: 1 }];
  const hash = buildCurrentHash({
    items: [{ price: 'price_abc', quantity: 1 }],
    termMonths: 1,
    address: { country: 'US' },
    shipping: { cost: 12.9 }
  });

  function buildRepo(overrides = {}) {
    const stripeBilling = {
      retrieveSubscription: jest.fn().mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        customer: 'cus_1',
        default_payment_method: { id: 'pm_123' },
        items: { data: currentItems.map((item) => ({ id: item.id, price: { id: item.price }, quantity: item.quantity })) },
        metadata: { wp_user_id: '7' }
      }),
      previewProration: jest.fn().mockResolvedValue({ amount_due: 0, total: 0, currency: 'usd' }),
      updateSubscriptionItems: jest.fn().mockResolvedValue({
        latest_invoice: {},
        default_payment_method: { id: 'pm_123' }
      }),
      resolvePaymentState: jest.fn().mockReturnValue('paid'),
      shippingProductId: 'prod_ship',
      ...overrides.stripeBilling
    };
    const ledgerRow = {
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1',
      status: 'active',
      subscriptionTermMonths: 1,
      address: { country: 'US' },
      shipping: { cost: 12.9 }
    };
    const ledgerRepository = {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(ledgerRow),
      upsert: jest.fn().mockResolvedValue(ledgerRow)
    };
    const planPreviewRepository = {
      previewPlan: jest.fn().mockResolvedValue({
        subscription_term_months: 1,
        catalog_pricing: { subtotal: 30, currency: 'USD', line_items: [] },
        pets: [{ pet_id: 'pet_1', pet_name: 'Milo' }]
      })
    };

    return new SubscriptionsEditCommitRepository({
      ledgerRepository,
      stripeBilling,
      planPreviewRepository,
      resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }])
    });
  }

  test('applies credit/none without a client secret and without first-purchase discounts', async () => {
    const repository = buildRepo();
    const result = await repository.commit(7, 'sub_123', {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: { country: 'US' },
      shipping: { cost: 12.9 }
    });

    expect(result.stripe_client_secret).toBeNull();
    expect(result.edit_payment_pending).toBe(false);
    expect(result.payment_state).toBe('paid');
    expect(repository.stripeBilling.updateSubscriptionItems).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      prorationBehavior: 'create_prorations'
    }));
    const updateArg = repository.stripeBilling.updateSubscriptionItems.mock.calls[0][0];
    expect(updateArg.discounts).toBeUndefined();
    expect(updateArg.promotion_code).toBeUndefined();
  });

  test('returns requires_confirmation when the proration invoice needs a PaymentIntent', async () => {
    const repository = buildRepo({
      stripeBilling: {
        retrieveSubscription: jest.fn().mockResolvedValue({
          id: 'sub_123',
          status: 'active',
          customer: 'cus_1',
          default_payment_method: { id: 'pm_123' },
          items: { data: currentItems.map((item) => ({ id: item.id, price: { id: item.price }, quantity: item.quantity })) },
          metadata: {}
        }),
        previewProration: jest.fn().mockResolvedValue({ amount_due: 1250, total: 1250, currency: 'usd' }),
        updateSubscriptionItems: jest.fn().mockResolvedValue({
          latest_invoice: {
            id: 'in_prorate',
            payment_intent: {
              id: 'pi_1',
              status: 'requires_confirmation',
              client_secret: 'pi_1_secret'
            }
          },
          default_payment_method: { id: 'pm_123' }
        }),
        resolvePaymentState: jest.fn().mockReturnValue('requires_confirmation'),
        shippingProductId: 'prod_ship'
      }
    });

    const result = await repository.commit(7, 'sub_123', {
      subscription_term_months: 1,
      expected_current_hash: hash,
      pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
      address: { country: 'US' },
      shipping: { cost: 12.9 },
      payment_method_id: 'pm_123'
    });

    expect(result.edit_payment_pending).toBe(true);
    expect(result.payment_state).toBe('requires_confirmation');
    expect(result.stripe_client_secret).toBe('pi_1_secret');
  });
});
