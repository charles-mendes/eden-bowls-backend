const { SubscriptionPaidCyclesService } = require('../src/services/subscription-paid-cycles.service');

function build({ cycles = {}, shipments = [], courier = [] } = {}) {
  const ledgerRepository = {
    listPaidCyclesBySubscription: jest.fn(async (id, limit) => (cycles[String(id)] || []).slice(0, limit))
  };
  const upsShipmentRepository = { listActiveByInvoiceIds: jest.fn(async () => shipments) };
  const courierDeliveryRepository = { listByInvoiceIds: jest.fn(async () => courier) };
  const service = new SubscriptionPaidCyclesService({ ledgerRepository, upsShipmentRepository, courierDeliveryRepository });
  return { service, ledgerRepository, upsShipmentRepository, courierDeliveryRepository };
}

const cycle = (invoice, extra = {}) => ({
  paidInvoiceId: invoice,
  preparationDay: '2026-11-08',
  productionStatus: 'ready',
  note: 'sem frango',
  deliveryDate: '2026-11-10',
  paidAt: '2026-11-01 12:00:00',
  ...extra
});

describe('SubscriptionPaidCyclesService.latestBySubscriptions', () => {
  test('asks the newest paid cycle of each subscription and maps it', async () => {
    const { service, ledgerRepository } = build({ cycles: { 1: [cycle('in_new'), cycle('in_old')] } });
    const result = await service.latestBySubscriptions([{ id: 1 }]);
    expect(ledgerRepository.listPaidCyclesBySubscription).toHaveBeenCalledWith(1, 1);
    expect(result.get('1')).toEqual({
      invoiceId: 'in_new',
      preparationDay: '2026-11-08',
      productionStatus: 'ready',
      productionNote: 'sem frango',
      deliveryDate: '2026-11-10',
      paidAt: '2026-11-01T12:00:00.000Z',
      upsShipment: null,
      courierDelivery: null
    });
  });

  test('a subscription with no paid cycle maps to null', async () => {
    const { service, upsShipmentRepository } = build();
    const result = await service.latestBySubscriptions([{ id: 2 }]);
    expect(result.get('2')).toBeNull();
    expect(upsShipmentRepository.listActiveByInvoiceIds).not.toHaveBeenCalled();
  });

  test('ignores a canceled courier attempt and keeps the latest other one', async () => {
    const { service } = build({
      cycles: { 1: [cycle('in_1')] },
      courier: [
        { id: 5, stripe_invoice_id: 'in_1', status: 'delivered', delivered_at: '2026-11-10 15:00:00' },
        { id: 9, stripe_invoice_id: 'in_1', status: 'canceled' }
      ]
    });
    const view = (await service.latestBySubscriptions([{ id: 1 }])).get('1');
    expect(view.courierDelivery).toMatchObject({ id: 5, status: 'delivered', deliveredAt: '2026-11-10T15:00:00.000Z' });
  });

  test('carries the active UPS shipment', async () => {
    const { service } = build({
      cycles: { 1: [cycle('in_1')] },
      shipments: [{ id: 3, stripe_invoice_id: 'in_1', status: 'label_created', tracking_number: '1Z999' }]
    });
    const view = (await service.latestBySubscriptions([{ id: 1 }])).get('1');
    expect(view.upsShipment).toEqual({ id: 3, status: 'label_created', trackingNumber: '1Z999' });
  });

  test('reads UPS and courier once for several subscriptions', async () => {
    const { service, upsShipmentRepository, courierDeliveryRepository } = build({
      cycles: { 1: [cycle('in_1')], 2: [cycle('in_2')], 3: [] }
    });
    const result = await service.latestBySubscriptions([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(upsShipmentRepository.listActiveByInvoiceIds).toHaveBeenCalledTimes(1);
    expect(upsShipmentRepository.listActiveByInvoiceIds).toHaveBeenCalledWith(['in_1', 'in_2']);
    expect(courierDeliveryRepository.listByInvoiceIds).toHaveBeenCalledTimes(1);
    expect(result.get('2').invoiceId).toBe('in_2');
    expect(result.get('3')).toBeNull();
  });
});
