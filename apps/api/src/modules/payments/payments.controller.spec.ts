import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

describe('PaymentsController', () => {
  let service: {
    syncCatalog: jest.Mock;
    syncCatalogProduct: jest.Mock;
    getSyncStatus: jest.Mock;
    getSyncHealth: jest.Mock;
    getStripePriceMap: jest.Mock;
    receiveStripeWebhook: jest.Mock;
  };
  let controller: PaymentsController;

  beforeEach(() => {
    service = {
      syncCatalog: jest.fn(),
      syncCatalogProduct: jest.fn(),
      getSyncStatus: jest.fn(),
      getSyncHealth: jest.fn(),
      getStripePriceMap: jest.fn(),
      receiveStripeWebhook: jest.fn(),
    };
    controller = new PaymentsController(service as unknown as PaymentsService);
  });

  it('syncCatalog should delegate to service', async () => {
    service.syncCatalog.mockResolvedValue({ syncJobId: 'job_1', status: 'completed' });

    const output = await controller.syncCatalog({ market: 'BR', currency: 'BRL' });

    expect(service.syncCatalog).toHaveBeenCalledWith({ market: 'BR', currency: 'BRL' });
    expect(output).toEqual({ syncJobId: 'job_1', status: 'completed' });
  });

  it('syncCatalogProduct should delegate to service', async () => {
    service.syncCatalogProduct.mockResolvedValue({ syncJobId: 'job_2', status: 'completed' });

    const output = await controller.syncCatalogProduct('product_1');

    expect(service.syncCatalogProduct).toHaveBeenCalledWith('product_1');
    expect(output).toEqual({ syncJobId: 'job_2', status: 'completed' });
  });

  it('getSyncStatus should delegate to service', async () => {
    service.getSyncStatus.mockResolvedValue({ syncJobId: 'job_3' });

    const output = await controller.getSyncStatus({ syncJobId: 'job_3' });

    expect(service.getSyncStatus).toHaveBeenCalledWith({ syncJobId: 'job_3' });
    expect(output).toEqual({ syncJobId: 'job_3' });
  });

  it('getSyncHealth should delegate to service', async () => {
    service.getSyncHealth.mockResolvedValue({ totalExpected: 1 });

    const output = await controller.getSyncHealth({ market: 'BR', currency: 'BRL' });

    expect(service.getSyncHealth).toHaveBeenCalledWith({ market: 'BR', currency: 'BRL' });
    expect(output).toEqual({ totalExpected: 1 });
  });

  it('getStripePriceMap should delegate to service', async () => {
    service.getStripePriceMap.mockResolvedValue({ stripePriceId: 'price_1' });

    const output = await controller.getStripePriceMap('product_1', 'variant_1', { currency: 'BRL' });

    expect(service.getStripePriceMap).toHaveBeenCalledWith('product_1', 'variant_1', { currency: 'BRL' });
    expect(output).toEqual({ stripePriceId: 'price_1' });
  });

  it('receiveStripeWebhook should delegate to service', async () => {
    service.receiveStripeWebhook.mockResolvedValue({ received: true });

    const output = await controller.receiveStripeWebhook(
      { eventId: 'evt_1', eventType: 'payment_intent.succeeded', payload: {} },
      'secret',
    );

    expect(service.receiveStripeWebhook).toHaveBeenCalledWith(
      { eventId: 'evt_1', eventType: 'payment_intent.succeeded', payload: {} },
      'secret',
    );
    expect(output).toEqual({ received: true });
  });
});
