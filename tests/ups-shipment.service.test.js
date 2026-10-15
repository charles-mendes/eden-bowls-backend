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
    adminBillingService: overrides.adminBillingService || {
      getSubscription: jest.fn().mockResolvedValue({
        id: '1',
        stripeSubscriptionId: 'sub_123',
        address: {
          name: 'Ana Costa',
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
    transactionalMailer
  });

  return { service, repository, transactionalMailer };
}

describe('UpsShipmentService.createForSubscription', () => {
  test('sends shipped mail after markCreated when reused is false', async () => {
    const { service, transactionalMailer, repository } = buildService();

    const result = await service.createForSubscription({
      subscriptionId: '1',
      invoiceId: 'in_1'
    });

    expect(repository.markCreated).toHaveBeenCalled();
    expect(result.data.reused).toBe(false);
    expect(transactionalMailer.notifyShipped).toHaveBeenCalledTimes(1);
    expect(transactionalMailer.notifyShipped).toHaveBeenCalledWith(expect.objectContaining({
      shipment: expect.objectContaining({ id: 9, tracking_number: '1Z999AA10123456784' })
    }));
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

  test('keeps the UPS label when shipped mail throws', async () => {
    const { service, repository } = buildService({
      transactionalMailer: {
        notifyShipped: jest.fn().mockRejectedValue(new Error('smtp down'))
      }
    });

    await expect(service.createForSubscription({
      subscriptionId: '1',
      invoiceId: 'in_1'
    })).resolves.toMatchObject({
      success: true,
      data: { reused: false }
    });
    expect(repository.markCreated).toHaveBeenCalled();
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
