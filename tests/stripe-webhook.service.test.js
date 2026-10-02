const { HttpError } = require('../src/core/http-error');
const { StripeWebhookService } = require('../src/services/stripe-webhook.service');

function buildService(overrides = {}) {
  const stripeBilling = overrides.stripeBilling || {
    constructEvent: jest.fn(),
    retrieveSubscription: jest.fn().mockResolvedValue(null),
    addShippingInvoiceItem: jest.fn().mockResolvedValue({})
  };
  const eventsRepository = overrides.eventsRepository || {
    insertIfNew: jest.fn().mockResolvedValue({ inserted: true }),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    listDue: jest.fn().mockResolvedValue([])
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
      shippingProductId: overrides.shippingProductId === undefined ? 'prod_ship' : overrides.shippingProductId,
      logger: overrides.logger || { error() {}, warn() {}, info() {} },
      transactionalMailer: overrides.transactionalMailer || null,
      withTimeout: overrides.withTimeout
    }),
    stripeBilling,
    eventsRepository,
    ledgerRepository,
    customerStore
  };
}

describe('StripeWebhookService', () => {
  test('returns 503 when the webhook secret is not configured', async () => {
    const { service, stripeBilling } = buildService({ webhookSecret: '' });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' })).rejects.toMatchObject({
      message: expect.stringContaining('STRIPE_US_WEBHOOK_SECRET'),
      statusCode: 503,
      details: { code: 'stripe_webhook_secret_missing' }
    });
    expect(stripeBilling.constructEvent).not.toHaveBeenCalled();
  });

  test('names only the path webhook secret when that account is not configured', async () => {
    const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');
    const usBilling = { constructEvent: jest.fn() };
    const brBilling = { constructEvent: jest.fn() };
    const service = new StripeWebhookService({
      stripeAccounts: new StripeAccounts({
        us: usBilling,
        br: brBilling,
        brEnabled: false,
        usWebhookSecret: '',
        brWebhookSecret: ''
      }),
      eventsRepository: { insertIfNew: jest.fn() },
      ledgerRepository: { upsert: jest.fn() }
    });

    await expect(service.handle({
      account: 'us',
      rawBody: Buffer.from('{}'),
      signature: 'sig'
    })).rejects.toMatchObject({
      message: expect.stringContaining('STRIPE_US_WEBHOOK_SECRET'),
      statusCode: 503,
      details: { code: 'stripe_webhook_secret_missing' }
    });
    await expect(service.handle({
      account: 'br',
      rawBody: Buffer.from('{}'),
      signature: 'sig'
    })).rejects.toMatchObject({
      message: expect.stringContaining('STRIPE_BR_WEBHOOK_SECRET'),
      statusCode: 503,
      details: { code: 'stripe_webhook_secret_missing' }
    });

    expect(usBilling.constructEvent).not.toHaveBeenCalled();
    expect(brBilling.constructEvent).not.toHaveBeenCalled();
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

  test('uses the subscription shipping product id instead of a cached one', async () => {
    const logger = { error() {}, warn: jest.fn(), info() {} };
    const { service, stripeBilling } = buildService({
      shippingProductId: 'prod_cached',
      logger
    });
    stripeBilling.shippingProductId = 'prod_cached';
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_meta',
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
        shipping_product_id: 'prod_meta'
      }
    });

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(stripeBilling.addShippingInvoiceItem).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'prod_meta',
      amount: 1290
    }));
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('uses the ledger shipping cost when metadata amount is missing', async () => {
    const { service, stripeBilling, ledgerRepository } = buildService({ shippingProductId: '' });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      shipping: { cost: 12.9 }
    });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_ledger',
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
      metadata: { shipping_product_id: 'prod_ship' }
    });

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(stripeBilling.addShippingInvoiceItem).toHaveBeenCalledWith(expect.objectContaining({
      productId: 'prod_ship',
      amount: 1290,
      currency: 'usd'
    }));
  });

  test('warns and skips shipping when the subscription has no product id', async () => {
    const logger = { error() {}, warn: jest.fn(), info() {} };
    const { service, stripeBilling } = buildService({
      shippingProductId: 'prod_cached',
      logger
    });
    stripeBilling.shippingProductId = 'prod_cached';
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_missing',
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
      metadata: { shipping_amount_minor: '1290', shipping_currency: 'usd' }
    });

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(stripeBilling.addShippingInvoiceItem).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      stripe_account: 'us'
    }, 'invoice.created skipped shipping: shipping_product_id missing.');
  });

  test('does not add shipping or warn when the cycle has no shipping amount', async () => {
    const logger = { error() {}, warn: jest.fn(), info() {} };
    const { service, stripeBilling } = buildService({
      shippingProductId: 'prod_cached',
      logger
    });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_zero',
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
      metadata: {}
    });

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(stripeBilling.addShippingInvoiceItem).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('rejects a BR-signed payload on the US endpoint without trying the BR secret', async () => {
    const usBilling = {
      constructEvent: jest.fn((rawBody, signature, secret) => {
        expect(secret).toBe('whsec_us');
        throw new HttpError(400, 'Invalid Stripe signature.', {
          code: 'stripe_webhook_signature_invalid'
        });
      }),
      retrieveSubscription: jest.fn(),
      addShippingInvoiceItem: jest.fn()
    };
    const brBilling = {
      constructEvent: jest.fn(),
      retrieveSubscription: jest.fn(),
      addShippingInvoiceItem: jest.fn()
    };
    const eventsRepository = { insertIfNew: jest.fn() };
    const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');
    const service = new StripeWebhookService({
      stripeAccounts: new StripeAccounts({
        us: usBilling,
        br: brBilling,
        brEnabled: true,
        usWebhookSecret: 'whsec_us',
        brWebhookSecret: 'whsec_br'
      }),
      eventsRepository,
      ledgerRepository: {
        findByStripeSubscriptionId: jest.fn(),
        upsert: jest.fn()
      }
    });

    await expect(service.handle({
      account: 'us',
      rawBody: Buffer.from('{"id":"evt_br"}'),
      signature: 't=1,v1=br_payload'
    })).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'stripe_webhook_signature_invalid' }
    });

    expect(usBilling.constructEvent).toHaveBeenCalledTimes(1);
    expect(brBilling.constructEvent).not.toHaveBeenCalled();
    expect(eventsRepository.insertIfNew).not.toHaveBeenCalled();
  });

  test('rejects a US-signed payload on the BR endpoint without trying the US secret', async () => {
    const usBilling = {
      constructEvent: jest.fn()
    };
    const brBilling = {
      constructEvent: jest.fn((rawBody, signature, secret) => {
        expect(secret).toBe('whsec_br');
        throw new HttpError(400, 'Invalid Stripe signature.', {
          code: 'stripe_webhook_signature_invalid'
        });
      })
    };
    const eventsRepository = { insertIfNew: jest.fn() };
    const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');
    const service = new StripeWebhookService({
      stripeAccounts: new StripeAccounts({
        us: usBilling,
        br: brBilling,
        brEnabled: true,
        usWebhookSecret: 'whsec_us',
        brWebhookSecret: 'whsec_br'
      }),
      eventsRepository,
      ledgerRepository: { upsert: jest.fn() }
    });

    await expect(service.handle({
      account: 'br',
      rawBody: Buffer.from('{"id":"evt_us"}'),
      signature: 't=1,v1=us_payload'
    })).rejects.toMatchObject({
      statusCode: 400,
      details: { code: 'stripe_webhook_signature_invalid' }
    });

    expect(brBilling.constructEvent).toHaveBeenCalledTimes(1);
    expect(usBilling.constructEvent).not.toHaveBeenCalled();
    expect(eventsRepository.insertIfNew).not.toHaveBeenCalled();
  });

  test('sends order-confirmed and admin mail on subscription_create invoice.paid', async () => {
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn().mockResolvedValue({ claimed: true }),
      notifyAdminNewSubscription: jest.fn().mockResolvedValue({ claimed: true })
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_create',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_1',
          customer: 'cus_1',
          subscription: 'sub_123',
          billing_reason: 'subscription_create',
          amount_paid: 18900,
          currency: 'usd',
          customer_email: 'ana@example.com'
        }
      }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      customer: 'cus_1',
      metadata: { wp_user_id: '7' }
    });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      customerEmail: 'ana@example.com',
      status: 'active'
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.notifyOrderConfirmed).toHaveBeenCalledTimes(1);
    expect(transactionalMailer.notifyAdminNewSubscription).toHaveBeenCalledTimes(1);
    expect(transactionalMailer.notifyOrderConfirmed).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      invoice: expect.objectContaining({ id: 'in_1', billing_reason: 'subscription_create' })
    }));
  });

  test('does not send P0 mail on subscription_cycle invoice.paid', async () => {
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn(),
      notifyAdminNewSubscription: jest.fn()
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_cycle',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_cycle',
          customer: 'cus_1',
          subscription: 'sub_123',
          billing_reason: 'subscription_cycle'
        }
      }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      customer: 'cus_1',
      metadata: { wp_user_id: '7' }
    });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      status: 'active'
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.notifyOrderConfirmed).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyAdminNewSubscription).not.toHaveBeenCalled();
  });

  test('sends payment-failed mail when ledger is already active', async () => {
    const transactionalMailer = {
      notifyPaymentFailed: jest.fn().mockResolvedValue({ claimed: true })
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_fail',
      type: 'invoice.payment_failed',
      data: {
        object: {
          id: 'in_fail',
          customer: 'cus_1',
          subscription: 'sub_123',
          amount_due: 18900,
          currency: 'usd',
          customer_email: 'ana@example.com'
        }
      }
    });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      customerEmail: 'ana@example.com',
      status: 'active'
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.notifyPaymentFailed).toHaveBeenCalledTimes(1);
    expect(ledgerRepository.updateCheckoutReference).not.toHaveBeenCalled();
  });

  test('returns 200 and keeps the event pending when dispatch throws', async () => {
    const { service, stripeBilling, eventsRepository, ledgerRepository } = buildService();
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_fail',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', subscription: 'sub_123' } }
    });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      stripeCustomerId: 'cus_1'
    });
    ledgerRepository.upsert.mockRejectedValue(new Error('dispatch failed'));

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(eventsRepository.markProcessed).not.toHaveBeenCalled();
    expect(eventsRepository.scheduleRetry).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt_fail',
      attempts: 1
    }));
    const nextAttemptAt = eventsRepository.scheduleRetry.mock.calls[0][0].nextAttemptAt;
    expect(nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 20 * 1000);
  });

  test('does not dispatch again when the event was already stored', async () => {
    const { service, stripeBilling, eventsRepository, ledgerRepository } = buildService();
    eventsRepository.insertIfNew.mockResolvedValue({ inserted: false });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_dup',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', subscription: 'sub_123' } }
    });
    const dispatch = jest.spyOn(service, 'dispatch');

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(dispatch).not.toHaveBeenCalled();
    expect(eventsRepository.markProcessed).not.toHaveBeenCalled();
    expect(ledgerRepository.upsert).not.toHaveBeenCalled();
  });

  test('returns an error and does not dispatch when the insert fails', async () => {
    const { service, stripeBilling, eventsRepository } = buildService();
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_insert',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', subscription: 'sub_123' } }
    });
    eventsRepository.insertIfNew.mockRejectedValue(new Error('insert failed'));
    const dispatch = jest.spyOn(service, 'dispatch');

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .rejects.toThrow('insert failed');
    expect(dispatch).not.toHaveBeenCalled();
    expect(eventsRepository.markProcessed).not.toHaveBeenCalled();
  });

  test('retries a pending event and marks it processed', async () => {
    const { service, stripeBilling, eventsRepository } = buildService();
    const event = {
      id: 'evt_retry',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', subscription: 'sub_123' } }
    };
    eventsRepository.listDue.mockResolvedValue([{
      eventId: 'evt_retry',
      stripeAccount: 'us',
      attempts: 1,
      createdAt: new Date()
    }]);
    stripeBilling.retrieveEvent = jest.fn().mockResolvedValue(event);
    const dispatch = jest.spyOn(service, 'dispatch').mockResolvedValue(undefined);

    await expect(service.retryPending()).resolves.toEqual({ scanned: 1, succeeded: 1, failed: 0 });
    expect(eventsRepository.listDue).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    expect(dispatch).toHaveBeenCalledWith(event, expect.objectContaining({ account: 'us' }));
    expect(eventsRepository.markProcessed).toHaveBeenCalledWith({
      eventId: 'evt_retry',
      stripeAccount: 'us'
    });
  });

  test('marks a missing Stripe event failed without side effects', async () => {
    const { service, stripeBilling, eventsRepository, ledgerRepository } = buildService();
    eventsRepository.listDue.mockResolvedValue([{
      eventId: 'evt_gone',
      stripeAccount: 'us',
      attempts: 1,
      createdAt: new Date()
    }]);
    stripeBilling.retrieveEvent = jest.fn().mockResolvedValue(null);

    await expect(service.retryPending()).resolves.toMatchObject({ failed: 1, succeeded: 0 });
    expect(eventsRepository.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt_gone',
      lastError: 'stripe_event_missing'
    }));
    expect(ledgerRepository.upsert).not.toHaveBeenCalled();
  });

  test('stops retrying after 8 attempts', async () => {
    const { service, stripeBilling, eventsRepository } = buildService();
    eventsRepository.listDue.mockResolvedValue([{
      eventId: 'evt_cap',
      stripeAccount: 'us',
      attempts: 7,
      createdAt: new Date()
    }]);
    stripeBilling.retrieveEvent = jest.fn().mockRejectedValue(new Error('stripe down'));

    await service.retryPending();

    expect(eventsRepository.markFailed).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt_cap',
      attempts: 8
    }));
    expect(eventsRepository.scheduleRetry).not.toHaveBeenCalled();
  });

  test('passes a 30 second timeout to each event retry', async () => {
    const withTimeout = jest.fn().mockRejectedValue(Object.assign(new Error('timeout'), { code: 'timeout' }));
    const { service, stripeBilling, eventsRepository } = buildService({ withTimeout });
    stripeBilling.retrieveEvent = jest.fn(() => new Promise(() => {}));
    eventsRepository.listDue.mockResolvedValue([{
      eventId: 'evt_slow',
      stripeAccount: 'us',
      attempts: 0,
      createdAt: new Date()
    }]);

    await service.retryPending();

    expect(withTimeout).toHaveBeenCalledWith(expect.any(Promise), 30000);
    expect(eventsRepository.scheduleRetry).toHaveBeenCalled();
  });
});
