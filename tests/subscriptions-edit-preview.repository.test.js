const { SubscriptionsEditPreviewRepository } = require('../src/infrastructure/repositories/subscriptions-edit-preview.repository');
const { ShippingQuoteSigner } = require('../src/core/shipping-quote-token');

const quoteSigner = new ShippingQuoteSigner({ secret: 'test-shipping-quote-secret' });
const US_EDIT_ADDRESS = { country: 'US', state: 'CA', postal_code: '94105', line1: '1 Market St', city: 'San Francisco' };

function signedShipping({ cost = 12.9, deliveryDays = 1 } = {}) {
  return {
    method_id: 'ups_ground',
    cost,
    total: cost,
    delivery_days: deliveryDays,
    quote_token: quoteSigner.sign({ country: 'US', zipcode: '94105', cost, deliveryDays })
  };
}

function buildRepo() {
  const stripeBilling = {
    retrieveSubscription: jest.fn().mockResolvedValue({
      id: 'sub_123',
      items: { data: [{ id: 'si_1', price: { id: 'price_abc' }, quantity: 1 }] }
    }),
    previewProration: jest.fn().mockResolvedValue({ amount_due: 0, total: 0, currency: 'usd' })
  };
  return new SubscriptionsEditPreviewRepository({
    ledgerRepository: {
      findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue({
        userId: 7,
        stripeSubscriptionId: 'sub_123',
        status: 'active',
        subscriptionTermMonths: 1,
        address: { country: 'US' },
        shipping: { cost: 12.9 }
      })
    },
    stripeBilling,
    planPreviewRepository: {
      previewPlan: jest.fn().mockResolvedValue({
        subscription_term_months: 1,
        catalog_pricing: { subtotal: 30, currency: 'USD', line_items: [] },
        pets: [{ pet_id: 'pet_1', pet_name: 'Milo' }]
      })
    },
    resolveSubscriptionItems: jest.fn().mockResolvedValue([{ price: 'price_abc', quantity: 1 }]),
    shippingQuoteSigner: quoteSigner
  });
}

const basePayload = {
  subscription_term_months: 1,
  pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }],
  address: US_EDIT_ADDRESS
};

describe('SubscriptionsEditPreviewRepository signed shipping quote', () => {
  test('refuses a shipping value changed after signing before asking Stripe', async () => {
    const repository = buildRepo();
    await expect(repository.preview(7, 'sub_123', {
      ...basePayload,
      shipping: { ...signedShipping(), cost: 0.5, total: 0.5 }
    })).rejects.toMatchObject({ statusCode: 422, details: { code: 'delivery_area_unverified' } });
    expect(repository.stripeBilling.retrieveSubscription).not.toHaveBeenCalled();
    expect(repository.stripeBilling.previewProration).not.toHaveBeenCalled();
  });

  test('a valid quote passes and the next cycle adds the signed shipping value', async () => {
    const repository = buildRepo();
    const result = await repository.preview(7, 'sub_123', { ...basePayload, shipping: signedShipping({ cost: 14.25 }) });
    expect(result.next_cycle.total).toBeCloseTo(44.25, 2);
  });

  test('a term change preview still works with a valid quote', async () => {
    const repository = buildRepo();
    const result = await repository.preview(7, 'sub_123', {
      ...basePayload,
      subscription_term_months: 3,
      shipping: signedShipping()
    });
    expect(result.term_change).toBe(true);
    expect(result.proposed.subscription_term_months).toBe(3);
  });
});
