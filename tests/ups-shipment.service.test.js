const { HttpError } = require('../src/core/http-error');
const { UpsShipmentService, upsRejectedShipment, withoutLabelImages } = require('../src/services/ups-shipment.service');

function buildService(overrides = {}) {
  const transactionalMailer = overrides.transactionalMailer || {
    notifyShipped: jest.fn().mockResolvedValue({ claimed: true })
  };
  const repository = overrides.repository || {
    findActiveByInvoiceId: jest.fn().mockResolvedValue(null),
    insertPending: jest.fn().mockResolvedValue({ id: 9 }),
    findByUpsShipmentId: jest.fn().mockResolvedValue(null),
    markCreated: jest.fn().mockResolvedValue({
      id: 9,
      tracking_number: '1Z999AA10123456784',
      status: 'created'
    }),
    deletePending: jest.fn().mockResolvedValue(undefined),
    markUnknown: jest.fn().mockResolvedValue({ id: 9, status: 'unknown' })
  };
  const service = new UpsShipmentService({
    repository,
    upsClient: overrides.upsClient || {
      isConfigured: () => true,
      createShipment: jest.fn().mockResolvedValue({
        upsShipmentId: 'ups_1',
        trackingNumber: '1Z999AA10123456784',
        serviceCode: '03',
        labelFormat: 'GIF'
      })
    },
    profileRepository: overrides.profileRepository,
    // A ready cycle unless the test says otherwise: the purchase asks for confirmation otherwise.
    ledgerRepository: overrides.ledgerRepository || {
      listPaidCyclesByInvoiceIds: jest.fn().mockResolvedValue([{ paidInvoiceId: 'in_1', productionStatus: overrides.productionStatus || 'ready' }]),
      findById: jest.fn().mockResolvedValue(null)
    },
    auditService: overrides.auditService,
    adminBillingService: overrides.adminBillingService || {
      getSubscriptionInvoice: overrides.getSubscriptionInvoice
        || jest.fn().mockResolvedValue({ status: 'paid', subscription: 'sub_123', billing_reason: 'subscription_cycle', subtotal: 14450 }),
      getSubscription: jest.fn().mockResolvedValue({
        id: '1',
        stripeSubscriptionId: 'sub_123',
        status: overrides.subscriptionStatus || 'active',
        ...(overrides.stripeAccount ? { stripeAccount: overrides.stripeAccount } : {}),
        address: overrides.address || {
          ...(overrides.addressName === undefined ? { name: 'Ana Costa' } : { name: overrides.addressName }),
          line1: '1 Main St',
          city: 'Miami',
          state: 'FL',
          postal_code: '33101',
          country: 'US'
        },
        shipping: { cost: 12.9 },
        user: { id: '7', email: 'ana@example.com' }
      })
    },
    shippingService: {
      settings: {
        us: {
          ship_from: { zipcode: '33101' },
          package: {},
          allowed_service_codes: ['03']
        }
      }
    },
    labelStorage: overrides.labelStorage,
    logger: overrides.logger,
    addressIssueService: overrides.addressIssueService,
    transactionalMailer
  });

  return { service, repository, transactionalMailer };
}

describe('UpsShipmentService label guards', () => {
  const create = (service) => service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} });

  test.each([
    ['an unpaid invoice', { status: 'open', subscription: 'sub_123' }, 'invoice_not_paid'],
    ['an invoice of another subscription', { status: 'paid', subscription: 'sub_other' }, 'invoice_not_in_subscription'],
    ['a paid $0 invoice of a skipped cycle', { status: 'paid', subscription: 'sub_123', billing_reason: 'subscription_cycle', subtotal: 0, amount_paid: 0 }, 'invoice_not_delivery'],
    ['a paid invoice that is not a delivery cycle', { status: 'paid', subscription: 'sub_123', billing_reason: 'manual', subtotal: 14450, amount_paid: 14450 }, 'invoice_not_delivery']
  ])('refuses %s before buying anything', async (_label, invoice, code) => {
    const { service, repository } = buildService({ getSubscriptionInvoice: jest.fn().mockResolvedValue(invoice) });

    await expect(create(service)).rejects.toMatchObject({ statusCode: 422, details: { code } });
    expect(repository.insertPending).not.toHaveBeenCalled();
    expect(service.upsClient.createShipment).not.toHaveBeenCalled();
  });

  test('Military address: a single purchase is refused before UPS', async () => {
    const { service, repository } = buildService();
    service.adminBillingService.getSubscription.mockResolvedValue({
      id: '1', stripeSubscriptionId: 'sub_123', user: { id: '7' },
      address: { name: 'Ana Costa', line1: 'Unit 2050 Box 4190', city: 'APO', state: 'AP', postal_code: '96278', country: 'US' }
    });

    await expect(create(service)).rejects.toMatchObject({ statusCode: 422, details: { code: 'military_address_not_supported' } });
    expect(repository.insertPending).not.toHaveBeenCalled();
    expect(service.upsClient.createShipment).not.toHaveBeenCalled();
  });

  test('accepts the subscription id of a newer Stripe invoice shape', async () => {
    const { service } = buildService({
      getSubscriptionInvoice: jest.fn().mockResolvedValue({
        status: 'paid',
        billing_reason: 'subscription_cycle',
        subtotal: 14450,
        parent: { subscription_details: { subscription: 'sub_123' } }
      })
    });

    await expect(create(service)).resolves.toMatchObject({ success: true });
  });

  test('buys the label of a delivery paid in full by a 100% coupon', async () => {
    const { service } = buildService({
      getSubscriptionInvoice: jest.fn().mockResolvedValue({
        status: 'paid', subscription: 'sub_123', billing_reason: 'subscription_create', subtotal: 14450, amount_paid: 0
      })
    });

    await expect(create(service)).resolves.toMatchObject({ success: true });
  });

  test('prints the checkout recipient over the account name', async () => {
    const { service } = buildService({
      addressName: '',
      profileRepository: { findUserById: jest.fn().mockResolvedValue({ displayName: 'Ana Costa' }) }
    });
    const subscription = await service.adminBillingService.getSubscription();
    service.adminBillingService.getSubscription.mockResolvedValue({
      ...subscription,
      address: { ...subscription.address, recipient_name: 'João Lima' }
    });

    await create(service);

    expect(service.upsClient.createShipment.mock.calls[0][0].shipTo.name).toBe('João Lima');
  });

  test('the label request carries the stored package with its dry ice weight', async () => {
    const { service } = buildService();
    service.shippingService.settings.us.package = { weight_lb: 10, length_in: 12, width_in: 12, height_in: 12, dry_ice_kg: 0.5 };

    await create(service);

    expect(service.upsClient.createShipment.mock.calls[0][0]).toMatchObject({
      package: { weight_lb: 10, dry_ice_kg: 0.5 },
      serviceCode: '03'
    });
  });

  test('prints the account name when the address has none', async () => {
    const { service } = buildService({
      addressName: '',
      profileRepository: { findUserById: jest.fn().mockResolvedValue({ displayName: 'Ana Costa' }) }
    });

    await create(service);

    expect(service.upsClient.createShipment.mock.calls[0][0].shipTo.name).toBe('Ana Costa');
  });

  test.each([['no name', ''], ['an email as name', 'ana@example.com']])('refuses a label with %s', async (_label, displayName) => {
    const { service, repository } = buildService({
      addressName: '',
      profileRepository: { findUserById: jest.fn().mockResolvedValue({ displayName }) }
    });

    await expect(create(service)).rejects.toMatchObject({ details: { code: 'recipient_name_missing' } });
    expect(repository.insertPending).not.toHaveBeenCalled();
  });
});

describe('UpsShipmentService label issues', () => {
  const address = { line1: '1 Main St', city: 'Miami', state: 'FL', postal_code: '33101', country: 'US', name: 'Ana Costa' };

  async function issuesFor(subscriptionAddress, overrides = {}, stripeAccount) {
    const { service, repository } = buildService(overrides);
    repository.listBySubscriptionId = jest.fn().mockResolvedValue([]);
    service.adminBillingService.getSubscription.mockResolvedValue({ id: '1', address: subscriptionAddress, user: { id: '7' }, ...(stripeAccount ? { stripeAccount } : {}) });
    const result = await service.listForSubscription('1', {});
    return result.data.label_issues;
  }

  test('a complete US order has none', async () => {
    await expect(issuesFor(address)).resolves.toEqual([]);
  });

  test.each([
    ['a US account delivered in Brazil', 'us', { ...address, country: 'BR' }],
    ['a US account with no country', 'us', { ...address, country: '' }],
    ['a Brazil account delivered in the US', 'br', address]
  ])('names %s a market exception, first', async (_label, account, subscriptionAddress) => {
    const issues = await issuesFor(subscriptionAddress, {}, account);
    expect(issues[0]).toEqual({ code: 'shipment_market_exception' });
  });

  test('a US account delivered in the US has none', async () => {
    await expect(issuesFor(address, {}, 'us')).resolves.toEqual([]);
  });

  test.each([
    ['a Brazilian address', { ...address, country: 'BR' }, [{ code: 'country_not_supported', country: 'BR' }]],
    ['a PO Box', { ...address, line1: 'PO Box 12' }, [{ code: 'po_box_not_allowed' }]],
    ['no zipcode', { ...address, postal_code: '' }, [{ code: 'address_incomplete' }]],
    ['an APO address', { ...address, city: 'APO', state: 'AE' }, [{ code: 'military_address_not_supported' }]],
    ['an FPO city', { ...address, city: 'fpo' }, [{ code: 'military_address_not_supported' }]]
  ])('warns about %s', async (_label, subscriptionAddress, expected) => {
    await expect(issuesFor(subscriptionAddress)).resolves.toEqual(expected);
  });

  test('warns about everything at once, and the purchase stops on the same reason', async () => {
    const overrides = { profileRepository: { findUserById: jest.fn().mockResolvedValue(null) } };
    const issues = await issuesFor({ ...address, name: '', country: 'BR' }, overrides);
    expect(issues.map((issue) => issue.code)).toEqual(['country_not_supported', 'recipient_name_missing']);

    const { service, repository } = buildService({ ...overrides, addressName: '' });
    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'recipient_name_missing' } });
    expect(repository.insertPending).not.toHaveBeenCalled();
  });

  test('warns when UPS is not configured', async () => {
    await expect(issuesFor(address, { upsClient: { isConfigured: () => false } }))
      .resolves.toEqual([{ code: 'ups_not_configured' }]);
  });
});

describe('UpsShipmentService tracking', () => {
  const delivered = {
    trackResponse: { shipment: [{ package: [{
      currentStatus: { description: 'Delivered', code: '011' },
      deliveryDate: [{ type: 'DEL', date: '20260512' }],
      deliveryTime: { type: 'DEL', endTime: '144653' },
      activity: [{ status: { type: 'D', description: 'DELIVERED ' }, date: '20260512', time: '144653' }]
    }] }] }
  };

  test('records the delivery and answers with the shipment, not the UPS payload', async () => {
    const shipment = { id: 9, subscription_id: '1', tracking_number: '1Z1', status: 'created' };
    const { service, repository } = buildService();
    repository.findById = jest.fn().mockResolvedValue(shipment);
    repository.recordTracking = jest.fn().mockResolvedValue({
      ...shipment, status: 'delivered', tracking_status: 'delivered', delivered_at: '2026-05-12 14:46:53'
    });
    service.upsClient.track = jest.fn().mockResolvedValue(delivered);

    const result = await service.refreshTracking(9, {});

    expect(repository.recordTracking).toHaveBeenCalledWith(9, expect.objectContaining({
      status: 'delivered', description: 'Delivered', deliveredAt: '2026-05-12 14:46:53'
    }), delivered);
    expect(result.data.shipment).toMatchObject({
      status: 'delivered',
      tracking_status: 'delivered',
      tracking_url: 'https://www.ups.com/track?tracknum=1Z1'
    });
    expect(result.data.tracking).toBeUndefined();
  });

  test('a delivered shipment cannot be voided', async () => {
    const { service, repository } = buildService();
    repository.findById = jest.fn().mockResolvedValue({ id: 9, subscription_id: '1', status: 'delivered', ups_shipment_id: 'ups_1' });
    service.upsClient.voidShipment = jest.fn();

    await expect(service.voidShipment(9, {})).rejects.toMatchObject({ details: { code: 'shipment_delivered' } });
    expect(service.upsClient.voidShipment).not.toHaveBeenCalled();
  });
});

describe('UpsShipmentService.createForSubscription', () => {
  test('UPS label created: buying the label sends no shipped letter', async () => {
    const { service, transactionalMailer, repository } = buildService();

    const result = await service.createForSubscription({
      subscriptionId: '1',
      invoiceId: 'in_1'
    });

    expect(repository.markCreated).toHaveBeenCalled();
    expect(result.data.reused).toBe(false);
    expect(transactionalMailer.notifyShipped).not.toHaveBeenCalled();
  });

  test('does not send shipped mail when the label is reused', async () => {
    const { service, transactionalMailer } = buildService({
      repository: {
        findActiveByInvoiceId: jest.fn().mockResolvedValue({
          id: 4,
          status: 'created',
          tracking_number: '1ZOLD'
        })
      }
    });

    const result = await service.createForSubscription({
      subscriptionId: '1',
      invoiceId: 'in_1'
    });

    expect(result.data.reused).toBe(true);
    expect(transactionalMailer.notifyShipped).not.toHaveBeenCalled();
  });

  test('an order still in production needs confirmation and buys nothing', async () => {
    const { service, repository } = buildService({ productionStatus: 'in_production' });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'ups_label_needs_confirmation', reasons: [{ code: 'production_not_ready', production_status: 'in_production' }] }
    });
    expect(repository.insertPending).not.toHaveBeenCalled();
    expect(service.upsClient.createShipment).not.toHaveBeenCalled();
  });

  test('a subscription not active needs confirmation', async () => {
    const { service } = buildService({ subscriptionStatus: 'past_due' });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} })).rejects.toMatchObject({
      details: { code: 'ups_label_needs_confirmation', reasons: [{ code: 'subscription_not_active', subscription_status: 'past_due' }] }
    });
  });

  test('a confirmed purchase buys the label and audits the confirmed reasons', async () => {
    const auditService = { record: jest.fn().mockResolvedValue() };
    const { service, repository } = buildService({ productionStatus: 'in_production', auditService });

    const result = await service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: { userId: 3 }, confirmNotReady: true });

    expect(result.data.reused).toBe(false);
    expect(repository.markCreated).toHaveBeenCalled();
    expect(auditService.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'ups_shipment.create',
      actor: { userId: 3 },
      targetUserId: '7',
      metadata: { shipmentId: 9, subscriptionId: '1', invoiceId: 'in_1', confirmedNotReady: ['production_not_ready'] }
    }));
  });

  test('a ready order buys without confirmation and audits no reason', async () => {
    const auditService = { record: jest.fn().mockResolvedValue() };
    const { service } = buildService({ auditService });

    await service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} });

    expect(auditService.record.mock.calls[0][0].metadata).not.toHaveProperty('confirmedNotReady');
  });

  test('an invoice that already has a label is reused without confirmation', async () => {
    const { service } = buildService({
      productionStatus: 'in_production',
      repository: { findActiveByInvoiceId: jest.fn().mockResolvedValue({ id: 4, status: 'created', tracking_number: '1ZOLD' }) }
    });

    const result = await service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} });

    expect(result.data.reused).toBe(true);
  });

  test('a refusal the customer can fix reports ups_check; a market exception reports nothing', async () => {
    const usAddress = { name: 'Ana Costa', line1: 'PO Box 12', city: 'Miami', state: 'FL', postal_code: '33101', country: 'US' };
    const addressIssueService = { report: jest.fn() };
    const { service } = buildService({ address: usAddress, stripeAccount: 'us', addressIssueService });
    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} }))
      .rejects.toMatchObject({ statusCode: 422, details: { code: 'po_box_not_allowed' } });
    expect(addressIssueService.report).toHaveBeenCalledWith({ subscription: expect.objectContaining({ stripeSubscriptionId: 'sub_123' }), source: 'ups_check' });

    const crossed = { report: jest.fn() };
    const other = buildService({ address: { ...usAddress, country: 'BR' }, stripeAccount: 'us', addressIssueService: crossed });
    await expect(other.service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} }))
      .rejects.toMatchObject({ details: { code: 'shipment_market_exception' } });
    expect(crossed.report).not.toHaveBeenCalled();
  });

  test('an incomplete address answers 422 before asking to confirm', async () => {
    const { service } = buildService({ productionStatus: 'in_production', addressName: '' });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('UpsShipmentService.recordTracking and the shipped letter', () => {
  const ledger = { id: 1, stripeSubscriptionId: 'sub_123', customerEmail: 'ana@example.com' };
  const row = (extra = {}) => ({ id: 9, subscription_id: '1', tracking_number: '1Z1', status: 'created', shipped_at: '2026-05-09 12:00:00', ...extra });
  const scanAnswer = (type, extra = {}) => ({
    trackResponse: { shipment: [{ package: [{ activity: [{ status: { type, description: type, ...extra }, date: '20260510', time: '180000' }] }] }] }
  });

  function setup({ stored, notify, ledgerRow = ledger } = {}) {
    const notifyShipped = notify || jest.fn().mockResolvedValue({ claimed: true });
    const repository = {
      recordTracking: jest.fn().mockResolvedValue(stored),
      markShippedLetterSent: jest.fn().mockResolvedValue(),
      listDeliveredAwaitingLetter: jest.fn().mockResolvedValue([])
    };
    const warn = jest.fn();
    const { service } = buildService({
      repository,
      transactionalMailer: { notifyShipped },
      ledgerRepository: { findById: jest.fn().mockResolvedValue(ledgerRow) },
      logger: { warn, error: jest.fn(), info: jest.fn() }
    });
    return { service, repository, notifyShipped, warn };
  }

  test('First read in transit: one letter to the ledger email, then marked sent', async () => {
    const stored = row({ tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00' });
    const { service, repository, notifyShipped } = setup({ stored });

    const result = await service.recordTracking(row(), scanAnswer('P'));

    expect(result.mailed).toBe(true);
    expect(notifyShipped).toHaveBeenCalledWith({ subscription: expect.objectContaining({ user: { email: 'ana@example.com' } }), shipment: stored });
    expect(repository.markShippedLetterSent).toHaveBeenCalledWith(9);
  });

  test('First read already delivered: one letter', async () => {
    const stored = row({ status: 'delivered', tracking_status: 'delivered', delivered_at: '2026-05-12 14:46:53' });
    const { service, notifyShipped } = setup({ stored });

    await service.recordTracking(row(), scanAnswer('D'));

    expect(notifyShipped).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['label created', row({ tracking_status: 'label_created' })],
    ['an exception before pickup', row({ tracking_status: 'exception' })],
    ['a voided row', row({ status: 'voided', tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00' })],
    ['a letter already sent', row({ tracking_status: 'in_transit', in_transit_at: '2026-05-10', shipped_letter_sent_at: '2026-05-09 12:00:00' })]
  ])('no letter for %s', async (_name, stored) => {
    const { service, notifyShipped } = setup({ stored });

    await service.recordTracking(row(), scanAnswer('M'));

    expect(notifyShipped).not.toHaveBeenCalled();
  });

  test('No customer email: the skip is logged with the shipment id and template', async () => {
    const stored = row({ tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00' });
    const { service, notifyShipped, warn } = setup({ stored, ledgerRow: { id: 1, customerEmail: null } });

    await service.recordTracking(row(), scanAnswer('P'));

    expect(notifyShipped).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({ shipmentId: 9, template: 'shipped' }, 'Shipped letter skipped: no customer email.');
  });

  test('SMTP fails: tracking stays stored and the letter stays due', async () => {
    const stored = row({ tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00' });
    const { service, repository } = setup({ stored, notify: jest.fn().mockResolvedValue({ failed: true, claimed: false }) });

    const result = await service.recordTracking(row(), scanAnswer('P'));

    expect(repository.recordTracking).toHaveBeenCalled();
    expect(result.mailed).toBe(false);
    expect(repository.markShippedLetterSent).not.toHaveBeenCalled();
  });

  test('Mailer throws: tracking stays stored', async () => {
    const stored = row({ tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00' });
    const { service, repository } = setup({ stored, notify: jest.fn().mockRejectedValue(new Error('smtp down')) });

    await expect(service.recordTracking(row(), scanAnswer('P'))).resolves.toMatchObject({ mailed: false });
    expect(repository.markShippedLetterSent).not.toHaveBeenCalled();
  });

  test('Refresh and tick together: the claim taken by the other marks the row and sends nothing', async () => {
    const stored = row({ tracking_status: 'in_transit', in_transit_at: '2026-05-10 18:00:00' });
    const { service, repository } = setup({ stored, notify: jest.fn().mockResolvedValue({ skipped: true, reason: 'duplicate' }) });

    const result = await service.recordTracking(row(), scanAnswer('P'));

    expect(result.mailed).toBe(false);
    expect(repository.markShippedLetterSent).toHaveBeenCalledWith(9);
  });

  test('delivered rows awaiting a letter are tried without UPS', async () => {
    const due = row({ status: 'delivered', tracking_status: 'delivered', delivered_at: '2026-05-12 14:46:53' });
    const { service, repository, notifyShipped } = setup({});
    repository.listDeliveredAwaitingLetter.mockResolvedValue([due]);
    service.upsClient.track = jest.fn();

    await expect(service.sendDueShippedLetters(20)).resolves.toBe(1);
    expect(notifyShipped).toHaveBeenCalledTimes(1);
    expect(service.upsClient.track).not.toHaveBeenCalled();
  });
});

function upsClientFailing(error) {
  return { isConfigured: () => true, createShipment: jest.fn().mockRejectedValue(error) };
}

describe('UpsShipmentService label idempotency', () => {
  const quietLogger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };

  test.each([
    ['a timeout', new HttpError(504, 'UPS request timed out.', { code: 'ups_timeout' })],
    ['a network error', new HttpError(503, 'UPS network error.', { code: 'ups_network_error' })],
    ['a UPS 5xx', new HttpError(502, 'UPS request failed.', { code: 'ups_upstream_error', status: 503 })],
    ['an incomplete ship answer', new HttpError(502, 'missing tracking', { code: 'ups_ship_incomplete' })]
  ])('%s keeps the row as unknown instead of deleting it', async (_label, failure) => {
    const { service, repository } = buildService({ upsClient: upsClientFailing(failure), logger: quietLogger });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' })).rejects.toMatchObject({
      statusCode: 502,
      details: { code: 'ups_shipment_unknown', shipment_id: 9 }
    });
    expect(repository.markUnknown).toHaveBeenCalledWith(9);
    expect(repository.deletePending).not.toHaveBeenCalled();
  });

  test.each([
    ['a UPS 4xx', new HttpError(502, 'invalid', { code: 'ups_upstream_error', status: 400 })],
    ['a failed token step', new HttpError(502, 'auth', { code: 'ups_oauth_failed', status: 401, stage: 'oauth' })],
    ['a token timeout', new HttpError(504, 'auth', { code: 'ups_timeout', stage: 'oauth' })]
  ])('%s deletes the pending row so the operator can try again', async (_label, failure) => {
    const { service, repository } = buildService({ upsClient: upsClientFailing(failure) });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' })).rejects.toBe(failure);
    expect(repository.deletePending).toHaveBeenCalledWith(9);
    expect(repository.markUnknown).not.toHaveBeenCalled();
  });

  test.each(['unknown', 'pending'])('an invoice with a %s row and no UPS id does not buy another label', async (status) => {
    const createShipment = jest.fn();
    const { service, repository } = buildService({
      upsClient: { isConfigured: () => true, createShipment },
      repository: {
        findActiveByInvoiceId: jest.fn().mockResolvedValue({ id: 4, status, ups_shipment_id: null }),
        insertPending: jest.fn()
      }
    });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' })).rejects.toMatchObject({
      statusCode: 409,
      details: { code: 'ups_shipment_unresolved', shipment_id: 4 }
    });
    expect(repository.insertPending).not.toHaveBeenCalled();
    expect(createShipment).not.toHaveBeenCalled();
  });

  test('losing the insert race returns the winner without calling UPS', async () => {
    const createShipment = jest.fn();
    const { service } = buildService({
      upsClient: { isConfigured: () => true, createShipment },
      repository: {
        findActiveByInvoiceId: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 5, status: 'created', ups_shipment_id: '1ZWIN' }),
        insertPending: jest.fn().mockResolvedValue(null)
      }
    });

    const result = await service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' });

    expect(result.data).toMatchObject({ reused: true, shipment: { id: 5 } });
    expect(createShipment).not.toHaveBeenCalled();
  });

  test('losing the insert race to a request still in flight answers 409', async () => {
    const { service } = buildService({
      repository: {
        findActiveByInvoiceId: jest.fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 5, status: 'pending', ups_shipment_id: null }),
        insertPending: jest.fn().mockResolvedValue(null)
      }
    });

    await expect(service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' })).rejects.toMatchObject({
      details: { code: 'ups_shipment_unresolved' }
    });
  });

  test('a label file write failure keeps the bought label and the image in raw_response', async () => {
    const raw = { ShipmentResponse: { ShipmentResults: { PackageResults: { ShippingLabel: { GraphicImage: 'R0lG' } } } } };
    const { service, repository } = buildService({
      logger: quietLogger,
      labelStorage: { write: jest.fn().mockRejectedValue(new Error('disk full')) },
      upsClient: {
        isConfigured: () => true,
        createShipment: jest.fn().mockResolvedValue({
          upsShipmentId: 'ups_1', trackingNumber: '1Z1', serviceCode: '03', labelFormat: 'GIF', labelBase64: 'R0lG', raw
        })
      }
    });

    await service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' });

    expect(repository.deletePending).not.toHaveBeenCalled();
    expect(repository.markCreated).toHaveBeenCalledWith(9, expect.objectContaining({ labelPath: null, rawResponse: raw }));
  });

  test('a stored label is removed from raw_response', async () => {
    const raw = { ShipmentResponse: { ShipmentResults: { PackageResults: { TrackingNumber: '1Z1', ShippingLabel: { GraphicImage: 'R0lG', HTMLImage: 'PGh0' } } } } };
    const { service, repository } = buildService({
      labelStorage: { write: jest.fn().mockResolvedValue('in_1.gif') },
      upsClient: {
        isConfigured: () => true,
        createShipment: jest.fn().mockResolvedValue({
          upsShipmentId: 'ups_1', trackingNumber: '1Z1', serviceCode: '03', labelFormat: 'GIF', labelBase64: 'R0lG', raw
        })
      }
    });

    await service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1' });

    const saved = repository.markCreated.mock.calls[0][1].rawResponse;
    expect(saved).toEqual({ ShipmentResponse: { ShipmentResults: { PackageResults: { TrackingNumber: '1Z1', ShippingLabel: {} } } } });
    expect(raw.ShipmentResponse.ShipmentResults.PackageResults.ShippingLabel.GraphicImage).toBe('R0lG');
  });

  test('helpers classify UPS failures and strip label images', () => {
    expect(upsRejectedShipment(new HttpError(502, 'x', { code: 'ups_upstream_error', status: 429 }))).toBe(true);
    expect(upsRejectedShipment(new HttpError(502, 'x', { code: 'ups_upstream_error', status: 500 }))).toBe(false);
    expect(upsRejectedShipment(new Error('socket hang up'))).toBe(false);
    expect(withoutLabelImages(null)).toBeNull();
  });
});

describe('UpsShipmentService.voidShipment', () => {
  function voidService(shipment, voidImpl = jest.fn().mockResolvedValue({})) {
    const repository = {
      findById: jest.fn().mockResolvedValue(shipment),
      markVoided: jest.fn().mockResolvedValue({ ...shipment, status: 'voided' })
    };
    const upsClient = { isConfigured: () => true, voidShipment: voidImpl };
    const service = new UpsShipmentService({ repository, upsClient });
    return { service, repository, upsClient };
  }

  test('an unresolved row without a UPS id needs explicit confirmation', async () => {
    const { service, repository, upsClient } = voidService({ id: 4, status: 'unknown', ups_shipment_id: null });

    await expect(service.voidShipment(4)).rejects.toMatchObject({ statusCode: 409, details: { code: 'ups_shipment_unresolved' } });
    expect(repository.markVoided).not.toHaveBeenCalled();

    const result = await service.voidShipment(4, {}, { confirmNotCreated: true });
    expect(result.data).toMatchObject({ local_only: true, shipment: { status: 'voided' } });
    expect(upsClient.voidShipment).not.toHaveBeenCalled();
  });

  test('a created label is voided in UPS', async () => {
    const { service, upsClient, repository } = voidService({ id: 4, status: 'created', ups_shipment_id: '1ZX' });

    await service.voidShipment(4);

    expect(upsClient.voidShipment).toHaveBeenCalledWith('1ZX');
    expect(repository.markVoided).toHaveBeenCalledWith(4);
  });
});

describe('UpsShipmentService purchase outcomes for the label queue', () => {
  const purchase = (service) => service.createForSubscription({ subscriptionId: '1', invoiceId: 'in_1', actor: {} });

  // One row per invoice, like uq_ups_shipments_active_invoice.
  function memoryRepository() {
    const rows = [];
    const active = (invoice) => rows.find((row) => row.stripe_invoice_id === invoice && row.status !== 'voided') || null;
    return {
      rows,
      findActiveByInvoiceId: jest.fn(async (invoice) => active(invoice)),
      insertPending: jest.fn(async ({ invoiceId }) => {
        if (active(invoiceId)) return null;
        const row = { id: rows.length + 1, stripe_invoice_id: invoiceId, status: 'pending', ups_shipment_id: null };
        rows.push(row);
        return row;
      }),
      findByUpsShipmentId: jest.fn(async () => null),
      markCreated: jest.fn(async (id, values) => Object.assign(rows.find((row) => row.id === id), {
        status: 'created', ups_shipment_id: values.upsShipmentId, tracking_number: values.trackingNumber
      })),
      markUnknown: jest.fn(async (id) => Object.assign(rows.find((row) => row.id === id), { status: 'unknown' })),
      deletePending: jest.fn()
    };
  }

  test('two simultaneous purchases on one invoice: one UPS call and no second row', async () => {
    const repository = memoryRepository();
    let release;
    const createShipment = jest.fn(() => new Promise((resolve) => {
      release = () => resolve({ upsShipmentId: 'ups_1', trackingNumber: '1Z1', serviceCode: '03', labelFormat: 'GIF' });
    }));
    const { service } = buildService({ repository, upsClient: { isConfigured: () => true, createShipment } });

    const first = purchase(service);
    await new Promise((resolve) => setImmediate(resolve));
    const second = purchase(service).catch((error) => error);
    await new Promise((resolve) => setImmediate(resolve));
    release();

    await expect(first).resolves.toMatchObject({ data: { reused: false } });
    expect(await second).toMatchObject({ statusCode: 409, details: { code: 'ups_shipment_unresolved', shipment_id: 1 } });
    expect(createShipment).toHaveBeenCalledTimes(1);
    expect(repository.rows).toHaveLength(1);
  });

  test('a timeout after UPS may have answered keeps the row unknown, and a later purchase gets 409', async () => {
    const repository = memoryRepository();
    const timeout = Object.assign(new Error('timeout'), { details: { code: 'ups_timeout' } });
    const createShipment = jest.fn().mockRejectedValue(timeout);
    const { service } = buildService({ repository, upsClient: { isConfigured: () => true, createShipment } });

    await expect(purchase(service)).rejects.toMatchObject({ statusCode: 502, details: { code: 'ups_shipment_unknown', shipment_id: 1 } });
    await expect(purchase(service)).rejects.toMatchObject({ statusCode: 409, details: { code: 'ups_shipment_unresolved', shipment_id: 1 } });

    expect(repository.rows).toEqual([expect.objectContaining({ id: 1, status: 'unknown' })]);
    expect(createShipment).toHaveBeenCalledTimes(1);
  });

  test('markCreated failing after the purchase keeps the row and logs the UPS id', async () => {
    const repository = memoryRepository();
    repository.markCreated = jest.fn().mockRejectedValue(Object.assign(new Error('db down'), { code: 'ER_LOCK' }));
    const error = jest.fn();
    const { service } = buildService({ repository, logger: { error, warn: jest.fn(), info: jest.fn() } });

    await expect(purchase(service)).rejects.toThrow('db down');

    expect(repository.rows).toEqual([expect.objectContaining({ id: 1, status: 'pending' })]);
    expect(repository.deletePending).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ shipmentId: 1, upsShipmentId: 'ups_1' }), 'UPS bought a label that could not be saved.');
  });
});
