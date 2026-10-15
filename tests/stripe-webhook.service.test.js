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
      customerInvoices: overrides.customerInvoices || null,
      withTimeout: overrides.withTimeout
    }),
    stripeBilling,
    eventsRepository,
    ledgerRepository,
    customerStore
  };
}

describe('StripeWebhookService', () => {
  const previousRuntime = process.env.EDEN_RUNTIME;

  beforeAll(() => {
    process.env.EDEN_RUNTIME = 'qa';
  });

  afterAll(() => {
    if (previousRuntime === undefined) {
      delete process.env.EDEN_RUNTIME;
    } else {
      process.env.EDEN_RUNTIME = previousRuntime;
    }
  });

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

  describe('signature from the other account', () => {
    const Stripe = require('stripe');
    const { StripeAccounts } = require('../src/infrastructure/stripe/stripe-accounts');
    const { StripeBillingClient } = require('../src/infrastructure/stripe/stripe-billing-client');
    const secrets = { us: 'whsec_us_test', br: 'whsec_br_test' };
    const payload = JSON.stringify({ id: 'evt_cross', type: 'customer.created', data: { object: {} } });

    function buildAccountService() {
      const billing = (account) => new StripeBillingClient({ account, client: { webhooks: Stripe.webhooks } });
      const eventsRepository = {
        insertIfNew: jest.fn().mockResolvedValue({ inserted: true }),
        markProcessed: jest.fn().mockResolvedValue(undefined)
      };
      const ledgerRepository = { upsert: jest.fn() };
      const service = new StripeWebhookService({
        stripeAccounts: new StripeAccounts({
          us: billing('us'),
          br: billing('br'),
          brEnabled: true,
          usWebhookSecret: secrets.us,
          brWebhookSecret: secrets.br,
          nodeEnv: 'test'
        }),
        eventsRepository,
        ledgerRepository,
        logger: { error() {}, warn() {}, info() {} }
      });
      return { service, eventsRepository, ledgerRepository };
    }

    test.each([
      ['br', 'us'],
      ['us', 'br']
    ])('rejects a payload signed by %s on the %s path with 400', async (signer, path) => {
      const { service, eventsRepository, ledgerRepository } = buildAccountService();
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: secrets[signer] });

      await expect(service.handle({
        account: path,
        rawBody: Buffer.from(payload),
        signature
      })).rejects.toMatchObject({
        statusCode: 400,
        details: { code: 'stripe_webhook_signature_invalid', stripe_account: path }
      });
      expect(eventsRepository.insertIfNew).not.toHaveBeenCalled();
      expect(ledgerRepository.upsert).not.toHaveBeenCalled();
    });

    test('warns about an event outside the subscribed list and still acknowledges it', async () => {
      const { service, eventsRepository } = buildAccountService();
      const warn = jest.fn();
      service.logger = { error() {}, warn, info() {} };
      const outside = JSON.stringify({ id: 'evt_outside', type: 'balance.available', data: { object: {} } });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload: outside, secret: secrets.us });

      await expect(service.handle({ account: 'us', rawBody: Buffer.from(outside), signature }))
        .resolves.toEqual({ received: true });

      expect(warn).toHaveBeenCalledWith(
        { stripe_account: 'us', eventId: 'evt_outside', type: 'balance.available' },
        'Stripe webhook event is not in the subscribed list.'
      );
      expect(eventsRepository.markProcessed).toHaveBeenCalledWith({ eventId: 'evt_outside', stripeAccount: 'us' });
    });

    test('does not warn about a subscribed event', async () => {
      const { service } = buildAccountService();
      const warn = jest.fn();
      service.logger = { error() {}, warn, info() {} };
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: secrets.us });

      await service.handle({ account: 'us', rawBody: Buffer.from(payload), signature });

      expect(warn).not.toHaveBeenCalled();
    });

    test('accepts the same payload on the path of the account that signed it', async () => {
      const { service, eventsRepository } = buildAccountService();
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: secrets.br });

      await service.handle({ account: 'br', rawBody: Buffer.from(payload), signature });

      expect(eventsRepository.insertIfNew).toHaveBeenCalledWith(expect.objectContaining({
        eventId: 'evt_cross',
        stripeAccount: 'br'
      }));
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
      metadata: { eden_env: 'qa', wp_user_id: '7' }
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

  describe('Eden Bowls invoice PDF', () => {
    const row = { id: 1, invoiceNumber: 'EB-2026-000418', emailStatus: 'pending', emailTo: 'ana@example.com' };
    const attachment = { invoiceNumber: 'EB-2026-000418', filename: 'EB-2026-000418.pdf', content: Buffer.from('%PDF') };

    function invoicesMock(overrides = {}) {
      return {
        issueForInvoice: jest.fn().mockResolvedValue({ row }),
        letterAttachment: jest.fn().mockResolvedValue(attachment),
        recordSentWithLetter: jest.fn().mockResolvedValue({}),
        sendEmail: jest.fn().mockResolvedValue({}),
        ...overrides
      };
    }

    function mailerMock(result = { claimed: true, skipped: false, to: 'ana@example.com' }) {
      return {
        notifyOrderConfirmed: jest.fn().mockResolvedValue(result),
        notifyAdminNewSubscription: jest.fn().mockResolvedValue({ claimed: true }),
        notifyRenewal: jest.fn().mockResolvedValue(result),
        notifyPlanChanged: jest.fn().mockResolvedValue({ claimed: true })
      };
    }

    function arrange({ customerInvoices, transactionalMailer = null, total = 14450, reason = 'subscription_cycle' }) {
      const built = buildService({ customerInvoices, transactionalMailer });
      built.stripeBilling.constructEvent.mockReturnValue({
        id: 'evt_inv',
        type: 'invoice.paid',
        data: { object: { id: 'in_1', customer: 'cus_1', subscription: 'sub_123', total, billing_reason: reason } }
      });
      built.stripeBilling.retrieveSubscription.mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        customer: 'cus_1',
        items: { data: [] },
        metadata: { eden_env: 'qa', wp_user_id: '7' }
      });
      built.ledgerRepository.findUserStateBySubscriptionId.mockResolvedValue({ userId: 7, checkoutReference: {} });
      built.ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({ userId: 7, stripeSubscriptionId: 'sub_123', customerEmail: 'ana@example.com' });
      return built;
    }

    const handle = (service) => service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    test.each([
      ['renewal', 'subscription_cycle', 'notifyRenewal'],
      ['order confirmation', 'subscription_create', 'notifyOrderConfirmed']
    ])('the %s carries the PDF and counts as the invoice send', async (_label, reason, letter) => {
      const customerInvoices = invoicesMock();
      const transactionalMailer = mailerMock();
      const { service } = arrange({ customerInvoices, transactionalMailer, reason });

      await expect(handle(service)).resolves.toEqual({ received: true });

      expect(customerInvoices.issueForInvoice).toHaveBeenCalledWith({ invoice: expect.objectContaining({ id: 'in_1' }), account: 'us', send: false });
      expect(transactionalMailer[letter]).toHaveBeenCalledWith(expect.objectContaining({ invoiceAttachment: attachment }));
      expect(customerInvoices.recordSentWithLetter).toHaveBeenCalledWith(row, { to: 'ana@example.com' });
      expect(customerInvoices.sendEmail).not.toHaveBeenCalled();
    });

    test('a charged plan change gets the invoice in its own email', async () => {
      const customerInvoices = invoicesMock();
      const transactionalMailer = mailerMock();
      const { service } = arrange({ customerInvoices, transactionalMailer, reason: 'subscription_update' });

      await handle(service);

      expect(customerInvoices.sendEmail).toHaveBeenCalledWith(row, {});
      expect(customerInvoices.recordSentWithLetter).not.toHaveBeenCalled();
    });

    test('a renewal letter that failed leaves the invoice to its own email', async () => {
      const customerInvoices = invoicesMock();
      const transactionalMailer = mailerMock({ failed: true, claimed: false });
      const { service } = arrange({ customerInvoices, transactionalMailer });

      await handle(service);

      expect(customerInvoices.sendEmail).toHaveBeenCalledWith(row, {});
    });

    test('an invoice already sent on an earlier attempt is not sent again', async () => {
      const customerInvoices = invoicesMock({ issueForInvoice: jest.fn().mockResolvedValue({ row: { ...row, emailStatus: 'sent' } }) });
      const { service } = arrange({ customerInvoices, transactionalMailer: mailerMock({ skipped: true, reason: 'duplicate' }) });

      await handle(service);

      expect(customerInvoices.sendEmail).not.toHaveBeenCalled();
      expect(customerInvoices.recordSentWithLetter).not.toHaveBeenCalled();
    });

    test('when the PDF fails before the letter, the letter still goes out and the PDF is retried with its own email', async () => {
      const issueForInvoice = jest.fn()
        .mockRejectedValueOnce(new Error('stripe timeout'))
        .mockResolvedValueOnce({ row });
      const customerInvoices = invoicesMock({ issueForInvoice });
      const transactionalMailer = mailerMock();
      const { service } = arrange({ customerInvoices, transactionalMailer });

      await expect(handle(service)).resolves.toEqual({ received: true });

      expect(transactionalMailer.notifyRenewal).toHaveBeenCalledWith(expect.objectContaining({ invoiceAttachment: null }));
      expect(issueForInvoice).toHaveBeenLastCalledWith({ invoice: expect.objectContaining({ id: 'in_1' }), account: 'us', send: true });
    });

    test('a $0 invoice (skip or postponement) gets no invoice PDF', async () => {
      const customerInvoices = invoicesMock();
      const { service } = arrange({ customerInvoices, total: 0 });

      await handle(service);

      expect(customerInvoices.issueForInvoice).not.toHaveBeenCalled();
    });

    test('a PDF that still fails at the end schedules the event for a retry', async () => {
      const customerInvoices = invoicesMock({ issueForInvoice: jest.fn().mockRejectedValue(new Error('disk full')) });
      const { service, eventsRepository } = arrange({ customerInvoices });

      await handle(service).catch(() => {});

      expect(eventsRepository.markProcessed).not.toHaveBeenCalled();
      expect(eventsRepository.scheduleRetry).toHaveBeenCalled();
    });
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
      notifyAdminNewSubscription: jest.fn().mockResolvedValue({ claimed: true }),
      notifyRenewal: jest.fn(),
      notifyPlanChanged: jest.fn()
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
      metadata: { eden_env: 'qa', wp_user_id: '7' }
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
    expect(transactionalMailer.notifyRenewal).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyPlanChanged).not.toHaveBeenCalled();
  });

  test('does not send P0 mail on subscription_cycle invoice.paid', async () => {
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn(),
      notifyAdminNewSubscription: jest.fn(),
      notifyRenewal: jest.fn().mockResolvedValue({ claimed: true }),
      notifyPlanChanged: jest.fn()
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
      metadata: { eden_env: 'qa', wp_user_id: '7' }
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
    expect(transactionalMailer.notifyPlanChanged).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyRenewal).toHaveBeenCalledTimes(1);
    expect(transactionalMailer.notifyRenewal).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      referenceId: 'in_cycle'
    }));
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

  test('sends plan changed only when invoice.paid promotes a pending edit', async () => {
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn(),
      notifyAdminNewSubscription: jest.fn(),
      notifyRenewal: jest.fn(),
      notifyPlanChanged: jest.fn().mockResolvedValue({ claimed: true })
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_plan',
      type: 'invoice.paid',
      data: {
        object: {
          id: 'in_plan',
          customer: 'cus_1',
          subscription: 'sub_123',
          billing_reason: 'subscription_cycle',
          amount_paid: 4200,
          currency: 'usd'
        }
      }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'active',
      customer: 'cus_1',
      metadata: { eden_env: 'qa', wp_user_id: '7' }
    });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      customerEmail: 'ana@example.com',
      editPaymentPending: true,
      editPending: { invoice_id: 'in_plan' }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.notifyPlanChanged).toHaveBeenCalledTimes(1);
    expect(transactionalMailer.notifyPlanChanged).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      referenceId: 'in_plan'
    }));
    expect(transactionalMailer.notifyOrderConfirmed).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyRenewal).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyAdminNewSubscription).not.toHaveBeenCalled();
  });

  test('does not mail when payment_intent.payment_failed updates checkout', async () => {
    const transactionalMailer = {
      notifyPaymentFailed: jest.fn()
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_pi_fail',
      type: 'payment_intent.payment_failed',
      data: {
        object: {
          id: 'pi_fail',
          status: 'requires_payment_method',
          customer: 'cus_1'
        }
      }
    });
    ledgerRepository.findUserStateByPaymentIntentId.mockResolvedValue({ userId: 7 });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.notifyPaymentFailed).not.toHaveBeenCalled();
    expect(ledgerRepository.updateCheckoutReference).toHaveBeenCalledWith(7, expect.objectContaining({
      payment_state: 'failed',
      stripe_payment_intent_id: 'pi_fail'
    }));
  });

  test('does not mail when payment_intent.succeeded updates checkout', async () => {
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn(),
      notifyRenewal: jest.fn(),
      notifyPaymentFailed: jest.fn()
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_pi_ok',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_ok',
          status: 'succeeded',
          metadata: { eden_env: 'qa' }
        }
      }
    });
    ledgerRepository.findUserStateByPaymentIntentId.mockResolvedValue({ userId: 7 });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.notifyOrderConfirmed).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyRenewal).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyPaymentFailed).not.toHaveBeenCalled();
    expect(ledgerRepository.updateCheckoutReference).toHaveBeenCalledWith(7, expect.objectContaining({
      stripe_payment_intent_id: 'pi_ok',
      stripe_payment_intent_status: 'succeeded'
    }));
  });

  function subscriptionEvent(type, subscription, previous) {
    return {
      id: `evt_${type}`,
      type,
      data: {
        object: subscription,
        previous_attributes: previous
      }
    };
  }

  function subscriptionFixture(overrides = {}) {
    return {
      id: 'sub_123',
      status: 'active',
      customer: 'cus_1',
      metadata: { eden_env: 'qa', wp_user_id: '7' },
      cancel_at_period_end: false,
      current_period_end: 1790000000,
      ...overrides
    };
  }

  test('mails pause, resume, and scheduled cancel only when previous attributes cross that edge', async () => {
    const transactionalMailer = {
      notifyPaused: jest.fn().mockResolvedValue({ claimed: true }),
      notifyResumed: jest.fn().mockResolvedValue({ claimed: true }),
      notifyCancelled: jest.fn().mockResolvedValue({ claimed: true }),
      notifyOrderConfirmed: jest.fn(),
      notifyRenewal: jest.fn(),
      hasSentClaim: jest.fn().mockResolvedValue(false)
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      customerEmail: 'ana@example.com',
      status: 'active'
    });

    stripeBilling.constructEvent.mockReturnValue(subscriptionEvent(
      'customer.subscription.updated',
      subscriptionFixture({ pause_collection: { behavior: 'void' } }),
      { pause_collection: null }
    ));
    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(transactionalMailer.notifyPaused).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'paused:evt_customer.subscription.updated'
    }));

    transactionalMailer.notifyPaused.mockClear();
    stripeBilling.constructEvent.mockReturnValue(subscriptionEvent(
      'customer.subscription.updated',
      subscriptionFixture({ pause_collection: null }),
      { pause_collection: { behavior: 'void' } }
    ));
    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(transactionalMailer.notifyResumed).toHaveBeenCalledTimes(1);
    expect(transactionalMailer.notifyOrderConfirmed).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyRenewal).not.toHaveBeenCalled();

    stripeBilling.constructEvent.mockReturnValue(subscriptionEvent(
      'customer.subscription.updated',
      subscriptionFixture({ cancel_at_period_end: true, current_period_end: 1790000000 }),
      { cancel_at_period_end: false }
    ));
    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(transactionalMailer.notifyCancelled).toHaveBeenCalledWith(expect.objectContaining({
      referenceId: 'cancel_scheduled:1790000000'
    }));

    transactionalMailer.notifyResumed.mockClear();
    transactionalMailer.notifyCancelled.mockClear();
    stripeBilling.constructEvent.mockReturnValue(subscriptionEvent(
      'customer.subscription.updated',
      subscriptionFixture({ cancel_at_period_end: false, pause_collection: null }),
      { cancel_at_period_end: true }
    ));
    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(transactionalMailer.notifyResumed).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyCancelled).not.toHaveBeenCalled();
  });

  test('skips a second cancelled letter when a sent claim already exists', async () => {
    const transactionalMailer = {
      notifyCancelled: jest.fn(),
      hasSentClaim: jest.fn().mockResolvedValue(true)
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      customerEmail: 'ana@example.com'
    });
    stripeBilling.constructEvent.mockReturnValue(subscriptionEvent(
      'customer.subscription.deleted',
      subscriptionFixture({ status: 'canceled' }),
      { status: 'active' }
    ));

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(transactionalMailer.hasSentClaim).toHaveBeenCalledWith({
      subscriptionId: 'sub_123',
      template: 'cancelled'
    });
    expect(transactionalMailer.notifyCancelled).not.toHaveBeenCalled();
  });

  test('mails cancel once when a subscription is deleted without a sent cancelled claim', async () => {
    const transactionalMailer = {
      notifyCancelled: jest.fn().mockResolvedValue({ claimed: true }),
      hasSentClaim: jest.fn().mockResolvedValue(false)
    };
    const { service, stripeBilling, ledgerRepository } = buildService({ transactionalMailer });
    ledgerRepository.findByStripeSubscriptionId.mockResolvedValue({
      userId: 7,
      stripeSubscriptionId: 'sub_123',
      customerEmail: 'ana@example.com'
    });
    stripeBilling.constructEvent.mockReturnValue(subscriptionEvent(
      'customer.subscription.deleted',
      subscriptionFixture({ status: 'canceled' }),
      {}
    ));

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(transactionalMailer.notifyCancelled).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub_123',
      referenceId: 'deleted'
    }));
  });

  test('returns 200 and keeps the event pending when dispatch throws', async () => {
    const { service, stripeBilling, eventsRepository, ledgerRepository } = buildService();
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_fail',
      type: 'invoice.paid',
      data: { object: { id: 'in_1', subscription: 'sub_123' } }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      customer: 'cus_1',
      metadata: { eden_env: 'qa', wp_user_id: '7' },
      items: { data: [{ price: { id: 'price_abc' } }] }
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

  test('does not apply a local invoice.paid on the QA runtime', async () => {
    const warn = jest.fn();
    const { service, stripeBilling, ledgerRepository } = buildService({
      logger: { error() {}, warn, info() {} }
    });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_local',
      type: 'invoice.paid',
      data: { object: { id: 'in_local', customer: 'cus_1', subscription: 'sub_local' } }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_local',
      metadata: { eden_env: 'local', wp_user_id: '7' }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });
    expect(ledgerRepository.upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt_local',
      reason: 'marker_mismatch'
    }), 'Stripe webhook ignored.');
  });

  test('does not apply an invoice.paid that has no marker', async () => {
    const warn = jest.fn();
    const { service, stripeBilling, ledgerRepository } = buildService({
      logger: { error() {}, warn, info() {} }
    });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_bare',
      type: 'invoice.paid',
      data: { object: { id: 'in_bare', customer: 'cus_1', subscription: 'sub_bare' } }
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_bare',
      metadata: { wp_user_id: '7' }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });
    expect(ledgerRepository.upsert).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'marker_missing'
    }), 'Stripe webhook ignored.');
  });

  test('does not attach a user from a mismatched payment intent', async () => {
    const { service, stripeBilling, ledgerRepository } = buildService();
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_pi',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_foreign',
          status: 'succeeded',
          metadata: { eden_env: 'local', wp_user_id: '42' }
        }
      }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });
    expect(ledgerRepository.findUserStateByPaymentIntentId).not.toHaveBeenCalled();
    expect(ledgerRepository.upsert).not.toHaveBeenCalled();
  });
});

describe('StripeWebhookService charged deliveries', () => {
  const previousRuntime = process.env.EDEN_RUNTIME;

  beforeAll(() => {
    process.env.EDEN_RUNTIME = 'qa';
  });

  afterAll(() => {
    if (previousRuntime === undefined) {
      delete process.env.EDEN_RUNTIME;
    } else {
      process.env.EDEN_RUNTIME = previousRuntime;
    }
  });

  // Mirrors subscription_charged_invoices: an invoice id is recorded once, and only a new row counts.
  function ledgerWith(initial) {
    let row = { userId: 7, stripeSubscriptionId: 'sub_123', status: 'active', subscriptionTermMonths: 3, ...initial };
    const recorded = new Set(initial.recordedInvoices || (initial.lastChargedInvoiceId ? [initial.lastChargedInvoiceId] : []));
    return {
      recorded,
      current: () => row,
      repository: {
        findByStripeSubscriptionId: jest.fn(async () => row),
        findUserStateBySubscriptionId: jest.fn().mockResolvedValue(null),
        findUserStateByPaymentIntentId: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(async (input) => {
          row = { ...row, ...(input.status ? { status: input.status } : {}) };
          return row;
        }),
        updateCheckoutReference: jest.fn().mockResolvedValue({}),
        seedChargedDeliveries: jest.fn(async (_id, earlier) => {
          earlier.forEach((id) => recorded.add(id));
          if (row.chargedDeliveries == null) row = { ...row, chargedDeliveries: recorded.size };
          return row;
        }),
        incrementChargedDeliveries: jest.fn(async (_id, invoiceId) => {
          if (!recorded.has(invoiceId)) {
            recorded.add(invoiceId);
            row = { ...row, chargedDeliveries: row.chargedDeliveries + 1, lastChargedInvoiceId: invoiceId };
          }
          return row;
        })
      }
    };
  }

  function billingStub(paid = []) {
    return {
      constructEvent: jest.fn(),
      retrieveSubscription: jest.fn().mockResolvedValue({
        id: 'sub_123',
        status: 'active',
        customer: 'cus_1',
        cancel_at_period_end: false,
        metadata: { eden_env: 'qa', wp_user_id: '7' }
      }),
      addShippingInvoiceItem: jest.fn(),
      listPaidInvoicesForSubscription: jest.fn().mockResolvedValue(paid),
      setCancelAtPeriodEnd: jest.fn().mockResolvedValue({})
    };
  }

  function paidEvent(invoice) {
    return {
      id: `evt_${invoice.id}`,
      type: 'invoice.paid',
      data: { object: { customer: 'cus_1', subscription: 'sub_123', status: 'paid', ...invoice } }
    };
  }

  async function deliver(service, stripeBilling, invoice) {
    stripeBilling.constructEvent.mockReturnValue(paidEvent(invoice));
    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });
  }

  test('seeds the charged count from the paid cycle invoices the first time', async () => {
    const ledger = ledgerWith({ chargedDeliveries: null });
    const stripeBilling = billingStub([
      { id: 'in_1', status: 'paid', billing_reason: 'subscription_create', subtotal: 9600, amount_paid: 9600 },
      { id: 'in_2', status: 'paid', billing_reason: 'subscription_update', subtotal: 3200, amount_paid: 3200 },
      { id: 'in_3', status: 'paid', billing_reason: 'subscription_update', subtotal: 0, amount_paid: 0 }
    ]);
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository });

    await deliver(service, stripeBilling, { id: 'in_4', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });

    // The earlier cycle invoices are recorded; the current one goes through the same insert as a later one.
    expect(ledger.repository.seedChargedDeliveries).toHaveBeenCalledWith('sub_123', ['in_1']);
    expect(ledger.repository.incrementChargedDeliveries).toHaveBeenCalledWith('sub_123', 'in_4');
    expect(ledger.current().chargedDeliveries).toBe(2);
  });

  test('a late repeat of an older invoice does not count again (3.10)', async () => {
    const ledger = ledgerWith({ chargedDeliveries: 1, lastChargedInvoiceId: 'in_1' });
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository });

    await deliver(service, stripeBilling, { id: 'in_2', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });
    await deliver(service, stripeBilling, { id: 'in_3', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });
    // Replayed with a new event id, so the event dedupe does not stop it; the invoice table does.
    stripeBilling.constructEvent.mockReturnValue({ ...paidEvent({ id: 'in_2', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 }), id: 'evt_replay_in_2' });
    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(ledger.current().chargedDeliveries).toBe(3);
  });

  test('adds one charged delivery per paid cycle invoice and repeats safely', async () => {
    const ledger = ledgerWith({ chargedDeliveries: 1, lastChargedInvoiceId: 'in_1' });
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository });

    await deliver(service, stripeBilling, { id: 'in_2', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });
    await service.handleInvoicePaid(paidEvent({ id: 'in_2', billing_reason: 'subscription_cycle', subtotal: 9600 }).data.object, { stripeBilling, account: 'us' });

    expect(ledger.repository.incrementChargedDeliveries).toHaveBeenCalledWith('sub_123', 'in_2');
    expect(ledger.current().chargedDeliveries).toBe(2);
    expect(stripeBilling.listPaidInvoicesForSubscription).not.toHaveBeenCalled();
  });

  test('a paid proration invoice and the $0 invoice of a skip do not raise the charged count', async () => {
    const ledger = ledgerWith({ chargedDeliveries: 1, lastChargedInvoiceId: 'in_1' });
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository });

    await deliver(service, stripeBilling, { id: 'in_prorate', billing_reason: 'subscription_update', subtotal: 3200, amount_paid: 3200 });
    await deliver(service, stripeBilling, { id: 'in_skip', billing_reason: 'subscription_update', subtotal: 0, amount_paid: 0 });
    await deliver(service, stripeBilling, { id: 'in_trial', billing_reason: 'subscription_cycle', subtotal: 0, amount_paid: 0 });

    expect(ledger.repository.incrementChargedDeliveries).not.toHaveBeenCalled();
    expect(ledger.current().chargedDeliveries).toBe(1);
  });

  test('the $0 invoice paid by a skip keeps the ledger trialing and sends no letter', async () => {
    const transactionalMailer = { notifyRenewal: jest.fn(), notifyOrderConfirmed: jest.fn(), notifyAdminNewSubscription: jest.fn() };
    const ledger = ledgerWith({ chargedDeliveries: 1, lastChargedInvoiceId: 'in_1' });
    const stripeBilling = billingStub();
    stripeBilling.retrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      status: 'trialing',
      customer: 'cus_1',
      cancel_at_period_end: false,
      metadata: { eden_env: 'qa', wp_user_id: '7' }
    });
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository, transactionalMailer });

    await deliver(service, stripeBilling, { id: 'in_skip', billing_reason: 'subscription_update', subtotal: 0, amount_paid: 0 });

    expect(ledger.repository.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'trialing' }));
    expect(ledger.current().chargedDeliveries).toBe(1);
    for (const name of Object.keys(transactionalMailer)) {
      expect(transactionalMailer[name]).not.toHaveBeenCalled();
    }
  });

  test('with renewal off, cancel_at_period_end stays off until the last contracted delivery is charged', async () => {
    const ledger = ledgerWith({ chargedDeliveries: 1, lastChargedInvoiceId: 'in_1', autoRenew: false, cancelAtPeriodEnd: false });
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository });

    await deliver(service, stripeBilling, { id: 'in_2', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });
    expect(stripeBilling.setCancelAtPeriodEnd).not.toHaveBeenCalled();

    await deliver(service, stripeBilling, { id: 'in_3', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });
    expect(ledger.current().chargedDeliveries).toBe(3);
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledTimes(1);
    expect(stripeBilling.setCancelAtPeriodEnd).toHaveBeenCalledWith('sub_123', true);
  });

  test('with renewal on, the last contracted delivery does not schedule a cancel', async () => {
    const ledger = ledgerWith({ chargedDeliveries: 2, lastChargedInvoiceId: 'in_2', autoRenew: true });
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository });

    await deliver(service, stripeBilling, { id: 'in_3', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });

    expect(ledger.current().chargedDeliveries).toBe(3);
    expect(stripeBilling.setCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  test('the paid invoice after a deferred charge sets the ledger active with only the renewal letter', async () => {
    const transactionalMailer = {
      notifyOrderConfirmed: jest.fn(),
      notifyAdminNewSubscription: jest.fn(),
      notifyRenewal: jest.fn().mockResolvedValue({ claimed: true }),
      notifyPlanChanged: jest.fn(),
      notifyCancelled: jest.fn(),
      notifyPaused: jest.fn(),
      notifyResumed: jest.fn()
    };
    const ledger = ledgerWith({ status: 'trialing', chargedDeliveries: 1, lastChargedInvoiceId: 'in_1', autoRenew: true });
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository, transactionalMailer });

    await deliver(service, stripeBilling, { id: 'in_deferred', billing_reason: 'subscription_cycle', subtotal: 9600, amount_paid: 9600 });

    expect(ledger.repository.upsert).toHaveBeenCalledTimes(1);
    expect(ledger.repository.upsert).toHaveBeenCalledWith(expect.objectContaining({ stripeSubscriptionId: 'sub_123', status: 'active' }));
    expect(ledger.current().status).toBe('active');
    expect(transactionalMailer.notifyRenewal).toHaveBeenCalledTimes(1);
    for (const name of ['notifyOrderConfirmed', 'notifyAdminNewSubscription', 'notifyPlanChanged', 'notifyCancelled', 'notifyPaused', 'notifyResumed']) {
      expect(transactionalMailer[name]).not.toHaveBeenCalled();
    }
    expect(stripeBilling.addShippingInvoiceItem).not.toHaveBeenCalled();
    expect(stripeBilling.setCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  test('customer.subscription.trial_will_end is stored as processed with no handler and no letter', async () => {
    const transactionalMailer = { notifyRenewal: jest.fn(), notifyCancelled: jest.fn() };
    const ledger = ledgerWith({});
    const stripeBilling = billingStub();
    const { service, eventsRepository } = buildService({ stripeBilling, ledgerRepository: ledger.repository, transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_trial_will_end',
      type: 'customer.subscription.trial_will_end',
      data: { object: { id: 'sub_123', status: 'trialing', customer: 'cus_1' } }
    });

    await expect(service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' }))
      .resolves.toEqual({ received: true });

    expect(eventsRepository.markProcessed).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'evt_trial_will_end' }));
    expect(stripeBilling.retrieveSubscription).not.toHaveBeenCalled();
    expect(ledger.repository.upsert).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyRenewal).not.toHaveBeenCalled();
    expect(transactionalMailer.notifyCancelled).not.toHaveBeenCalled();
  });

  test('a skip that turns the subscription trialing stores trialing and sends no letter', async () => {
    const transactionalMailer = {
      notifyPaused: jest.fn(),
      notifyResumed: jest.fn(),
      notifyCancelled: jest.fn(),
      notifyRenewal: jest.fn()
    };
    const ledger = ledgerWith({});
    const stripeBilling = billingStub();
    const { service } = buildService({ stripeBilling, ledgerRepository: ledger.repository, transactionalMailer });
    stripeBilling.constructEvent.mockReturnValue({
      id: 'evt_skip',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          status: 'trialing',
          customer: 'cus_1',
          cancel_at_period_end: false,
          trial_end: 1790000000,
          metadata: { eden_env: 'qa', wp_user_id: '7' },
          items: { data: [{ current_period_start: 1789000000, current_period_end: 1790000000 }] }
        },
        previous_attributes: { status: 'active', trial_end: null }
      }
    });

    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });

    expect(ledger.repository.upsert).toHaveBeenCalledWith(expect.objectContaining({ status: 'trialing', currentPeriodEnd: 1790000000 }));
    for (const name of Object.keys(transactionalMailer)) {
      expect(transactionalMailer[name]).not.toHaveBeenCalled();
    }
  });
});
