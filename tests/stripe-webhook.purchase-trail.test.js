const { StripeWebhookService } = require('../src/services/stripe-webhook.service');
const { CustomerPurchaseTrailService } = require('../src/services/customer-purchase-trail.service');

function fakeTrailRepository(attempts = []) {
  const repository = {
    events: [],
    transitions: [],
    insertEvent: jest.fn(async (row) => { repository.events.push(row); return 1; }),
    transitionAttempt: jest.fn(async (id, transition) => { repository.transitions.push([id, transition]); return 1; }),
    findAttemptForPayment: jest.fn(async ({ userId, market, subscriptionId, attemptId }) => attempts.find((row) => row.user_id === userId
      && row.market === market
      && ((subscriptionId && row.subscription_id === subscriptionId) || (attemptId && row.attempt_id === attemptId))) || null)
  };
  return repository;
}

function build({ event, ledger = {}, attempts = [], dispatchError = null } = {}) {
  const stripeBilling = {
    constructEvent: jest.fn(() => event),
    retrieveSubscription: jest.fn().mockResolvedValue(null),
    retrieveEvent: jest.fn()
  };
  const eventsRepository = {
    insertIfNew: jest.fn().mockResolvedValue({ inserted: true }),
    markProcessed: jest.fn().mockResolvedValue(undefined),
    scheduleRetry: jest.fn().mockResolvedValue(undefined),
    markFailed: jest.fn().mockResolvedValue(undefined),
    listDue: jest.fn().mockResolvedValue([])
  };
  const ledgerRepository = {
    findByStripeSubscriptionId: jest.fn().mockResolvedValue(ledger.row || null),
    findUserStateBySubscriptionId: jest.fn().mockResolvedValue(ledger.state || null),
    findUserStateByPaymentIntentId: jest.fn().mockResolvedValue(ledger.paymentState || null),
    upsert: jest.fn().mockResolvedValue({}),
    updateCheckoutReference: jest.fn().mockResolvedValue({})
  };
  const repository = fakeTrailRepository(attempts);
  const purchaseTrail = new CustomerPurchaseTrailService({ repository });
  const service = new StripeWebhookService({
    stripeBilling,
    webhookSecret: 'whsec_test',
    eventsRepository,
    ledgerRepository,
    customerStore: { findUserIdByCustomerId: jest.fn().mockResolvedValue(null) },
    purchaseTrail,
    logger: { error() {}, warn() {}, info() {} }
  });
  if (dispatchError) {
    jest.spyOn(service, 'dispatch').mockRejectedValue(dispatchError);
  }
  return { service, repository, eventsRepository, stripeBilling };
}

// customer-purchase-trail
describe('Stripe webhook purchase trail', () => {
  const previousRuntime = process.env.EDEN_RUNTIME;
  beforeAll(() => { process.env.EDEN_RUNTIME = 'qa'; });
  afterAll(() => {
    if (previousRuntime === undefined) delete process.env.EDEN_RUNTIME;
    else process.env.EDEN_RUNTIME = previousRuntime;
  });

  test('a /br delivery that will be retried writes nothing', async () => {
    const event = { id: 'evt_1', type: 'invoice.paid', data: { object: { id: 'in_1', subscription: 'sub_1' } } };
    const { service, repository, eventsRepository } = build({ event, dispatchError: new Error('db busy') });
    await expect(service.handle({ account: 'br', rawBody: Buffer.from('{}'), signature: 'sig' })).resolves.toEqual({ received: true });
    expect(eventsRepository.scheduleRetry).toHaveBeenCalled();
    expect(repository.events).toHaveLength(0);
  });

  test('a /br event that exhausts its retries writes market br and the ledger customer, once', async () => {
    const { service, repository, eventsRepository } = build({ ledger: { row: { userId: 7, stripeAccount: 'br' } } });
    jest.spyOn(service, 'redeliver').mockRejectedValue(Object.assign(new Error('boom'), { code: 'ledger_write_failed' }));
    const row = {
      eventId: 'evt_9', stripeAccount: 'br', type: 'invoice.paid', attempts: 7, createdAt: new Date(),
      payloadSummary: JSON.stringify({ customer: 'cus_1', subscription: 'sub_1', object_id: 'in_1' })
    };
    await service.retryOne(row, 1000);
    expect(eventsRepository.markFailed).toHaveBeenCalled();
    expect(repository.events).toHaveLength(1);
    expect(repository.events[0]).toMatchObject({
      market: 'br', stripe_account: 'br', user_id: 7, area: 'webhook', step: 'webhook_failed',
      stripe_event_id: 'evt_9', stripe_event_type: 'invoice.paid', subscription_id: 'sub_1', error_code: 'ledger_write_failed'
    });
    // Only the existing idempotency row lives in stripe_webhook_events: the trail adds nothing there.
    expect(eventsRepository.insertIfNew).not.toHaveBeenCalled();
    expect(JSON.stringify(repository.events)).not.toContain('cus_1');
  });

  test('the legacy endpoint writes market us; an unresolved customer leaves user_id null', async () => {
    const event = {
      id: 'evt_2', type: 'customer.subscription.updated',
      data: { object: { id: 'sub_2', customer: 'cus_2', status: 'active', metadata: { eden_env: 'qa' } } }
    };
    const { service, repository } = build({ event });
    await service.handle({ rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(repository.events[0]).toMatchObject({ market: 'us', user_id: null, step: 'customer_not_resolved', stripe_event_id: 'evt_2' });
  });

  test('a declined invoice with the tab closed is written and closes the checkout attempt failed', async () => {
    const event = { id: 'evt_3', type: 'invoice.payment_failed', data: { object: { id: 'in_3', subscription: 'sub_3', customer: 'cus_3', payment_intent: 'pi_3' } } };
    const { service, repository } = build({
      event,
      ledger: { paymentState: { userId: 7, checkoutReference: { attempt_id: 'att_3' } } },
      attempts: [{ id: 11, user_id: 7, market: 'us', attempt_id: 'att_3' }]
    });
    await service.handle({ account: 'us', rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(repository.events[0]).toMatchObject({ user_id: 7, market: 'us', step: 'payment_failed', attempt_row_id: 11, error_code: 'invoice_payment_failed' });
    expect(repository.transitions).toEqual([[11, 'failed']]);
  });

  test('a paid invoice resolved in the ledger closes the attempt paid', async () => {
    const event = { id: 'evt_4', type: 'invoice.paid', data: { object: { id: 'in_4', customer: 'cus_4', subscription: 'sub_4' } } };
    const { service, repository, stripeBilling } = build({
      event,
      ledger: { state: { userId: 7, checkoutReference: { stripe_subscription_id: 'sub_4', attempt_id: 'att_4' } } },
      attempts: [{ id: 12, user_id: 7, market: 'br', subscription_id: 'sub_4', attempt_id: 'att_4' }]
    });
    stripeBilling.retrieveSubscription.mockResolvedValue({ id: 'sub_4', status: 'active', customer: 'cus_4', items: { data: [] }, metadata: { eden_env: 'qa', wp_user_id: '7' } });
    await service.handle({ account: 'br', rawBody: Buffer.from('{}'), signature: 'sig' });
    expect(repository.events.find((row) => row.step === 'invoice_paid')).toMatchObject({ user_id: 7, market: 'br', outcome: 'ok', attempt_row_id: 12 });
    expect(repository.transitions).toContainEqual([12, 'paid']);
  });
});
