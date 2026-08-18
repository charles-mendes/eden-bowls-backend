const { SubscriptionsEditPreviewService } = require('../src/services/subscriptions-edit-preview.service');

const validPayload = {
  subscription_term_months: 1,
  pets: [{ pet_name: 'Milo', enabled: true, selected_flavors: ['chicken'], flavor_weights: [100] }]
};

describe('SubscriptionsEditPreviewService', () => {
  test('returns 422 for an invalid term', async () => {
    const service = new SubscriptionsEditPreviewService({ preview: jest.fn() }, {
      ledgerRepository: { findByUserIdAndSubscriptionId: jest.fn() }
    });

    await expect(service.preview({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: { ...validPayload, subscription_term_months: 2 }
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'invalid_subscription_term' }
    });
  });

  test('returns 422 when the subscription is canceled', async () => {
    const service = new SubscriptionsEditPreviewService({ preview: jest.fn() }, {
      ledgerRepository: {
        findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue({
          status: 'canceled',
          editPaymentPending: false
        }),
        listByUserId: jest.fn()
      }
    });

    await expect(service.preview({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: validPayload
    })).rejects.toMatchObject({
      statusCode: 422,
      details: { code: 'subscription_not_editable' }
    });
  });

  test('returns 409 when edit payment is pending', async () => {
    const service = new SubscriptionsEditPreviewService({ preview: jest.fn() }, {
      ledgerRepository: {
        findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue({
          status: 'active',
          editPaymentPending: true
        }),
        listByUserId: jest.fn()
      }
    });

    await expect(service.preview({
      userId: 7,
      subscriptionId: 'sub_123',
      payload: validPayload
    })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'edit_payment_pending' }
    });
  });

  test('returns 404 for another user subscription', async () => {
    const service = new SubscriptionsEditPreviewService({ preview: jest.fn() }, {
      ledgerRepository: {
        findByUserIdAndSubscriptionId: jest.fn().mockResolvedValue(null)
      }
    });

    await expect(service.preview({
      userId: 7,
      subscriptionId: 'sub_other',
      payload: validPayload
    })).rejects.toMatchObject({
      statusCode: 404,
      details: { code: 'subscription_not_found' }
    });
  });
});
