const { HttpError } = require('../src/core/http-error');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');

function buildService(overrides = {}) {
  const stripeBilling = overrides.stripeBilling || {
    constructEvent: jest.fn(),
    retrieveSubscription: jest.fn().mockResolvedValue(null),
    addShippingInvoiceItem: jest.fn().mockResolvedValue({})
  };
  const eventsRepository = overrides.eventsRepository || {
    insertIfNew: jest.fn().mockResolvedValue({ inserted: true })
  };
  const ledgerRepository = overrides.ledgerRepository || {
    findByStripeSubscriptionId: jest.fn().mockResolvedValue(null),
    findUserStateBySubscriptionId: jest.fn().mockResolvedValue(null),
    findUserStateByPaymentIntentId: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue({}),
    updateCheckoutReference: jest.fn().mockResolvedValue({})
  };
  const customerStore = overrides.customerStore || {
    findUserIdByCustomerId: jest.fn().mockResolvedValue(null)
  };

  return {
    service: new StripeWebhookService({
      stripeBilling,
      webhookSecret: overrides.webhookSecret === undefined ? 'whsec_test' : overrides.webhookSecret,
      eventsRepository,
      ledgerRepository,
      customerStore,
      shippingProductId: 'prod_ship'
    }),
    stripeBilling,
    eventsRepository,
    ledgerRepository,
    customerStore
  };
}

describe('StripeWebhookService', () => {
  test('returns 503 when the webhook secret is not configured', async () => {
    const { service } = buildService({ webhookSecret: '' });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' })).rejects.toMatchObject({
      statusCode: 503,
      details: { code: 'stripe_webhook_secret_missing' }
    });
  });

  test('returns 400 when Stripe-Signature is missing', async () => {
    const { service, stripeBilling } = buildService();
    stripeBilling.constructEvent.mockImplementation(() => {
      throw new HttpError(400, 'Missing Stripe-Signature header.', {
        code: 'stripe_webhook_signature_invalid'
      });
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: '' })).rejects.toMatchObject({
      statusCode: 400
    });
  });

  test('marks checkout paid and upserts the ledger on invoice.paid', async () => {
    const { service, stripeBilling, ledgerRepository } = buildService();
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_1',
          subscription: 'sub_123'
        }
      }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      customer: 'cus_1',
      cancel_at_period_end: false,
      current_period_start: 1700000000,
      current_period_end: 1702592000,
      items: { data: [{ price: { id: 'price_abc' }, quantity: 1 }] },
      metadata: { wp_user_id: '7' }
    });
    ledgerRepository.findUserStateBySubscriptionId.mockResolvedValue({
      userId: 7,
      checkoutReference: { stripe_subscription_id: 'sub_123' }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(ledgerRepository.upsert).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      status: 'active'
    }));
    expect(ledgerRepository.updateCheckoutReference).toHaveBeenCalledWith(7, expect.objectContaining({
      payment_state: 'paid'
    }));
  });

  test('does not reprocess a duplicate event id', async () => {
    const { service, stripeBilling, eventsRepository, ledgerRepository } = buildService();
    eventsRepository.insertIfNew.mockResolvedValue({ inserted: false });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', subscription: 'sub_123' } }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });
    expect(ledgerRepository.upsert).not.toHaveBeenCalled();
  });

  test('adds shipping on subscription_cycle draft invoices', async () => {
    const { service, stripeBilling } = buildService();
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'invoice.created',
      data: {
        object: {
          id: 'in_cycle',
          status: 'draft',
          billing_reason: 'subscription_cycle',
          customer: 'cus_1',
          subscription: 'sub_123',
          currency: 'usd'
        }
      }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      metadata: {
        shipping_amount_minor: '1290',
        shipping_currency: 'usd',
        shipping_product_id: 'prod_ship'
      }
    });

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(stripeBilling.addShippingInvoiceItem).toHaveBeenCalledWith({
      invoiceId: 'in_cycle',
      customerId: 'cus_1',
      productId: 'prod_ship',
      amount: 1290,
      currency: 'usd'
    });
  });
});
