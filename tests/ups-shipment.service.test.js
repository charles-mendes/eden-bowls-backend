const { UpsShipmentService } = require('../src/services/ups-shipment.service');

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
    deletePending: jest.fn()
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
