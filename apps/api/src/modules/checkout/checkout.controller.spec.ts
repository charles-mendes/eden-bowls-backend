import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';

describe('CheckoutController', () => {
  let service: {
    createCheckoutOrder: jest.Mock;
    acknowledgePaymentIntent: jest.Mock;
  };
  let controller: CheckoutController;

  beforeEach(() => {
    service = {
      createCheckoutOrder: jest.fn(),
      acknowledgePaymentIntent: jest.fn(),
    };
    controller = new CheckoutController(service as unknown as CheckoutService);
  });

  it('createCheckout should delegate to service', async () => {
    service.createCheckoutOrder.mockResolvedValue({ checkoutOrderId: 'co_1' });

    const output = await controller.createCheckout(
      'session_1',
      'idem-1',
      {
        snapshotHash: 'snap_1',
        selectedShipping: { quoteId: 'quote_1', rateId: 'rate_1' },
        billingAddress: {
          country: 'BR',
          state: 'SP',
          city: 'Sao Paulo',
          postcode: '01310-000',
          address1: 'Av Paulista, 1000',
        },
      } as never,
    );

    expect(service.createCheckoutOrder).toHaveBeenCalledWith(
      'session_1',
      'idem-1',
      expect.objectContaining({ snapshotHash: 'snap_1' }),
    );
    expect(output).toEqual({ checkoutOrderId: 'co_1' });
  });

  it('ackPaymentIntent should delegate to service', async () => {
    service.acknowledgePaymentIntent.mockResolvedValue({ paymentState: 'succeeded' });

    const output = await controller.ackPaymentIntent('session_1', {
      paymentIntentId: 'pi_1',
      status: 'succeeded',
    });

    expect(service.acknowledgePaymentIntent).toHaveBeenCalledWith('session_1', {
      paymentIntentId: 'pi_1',
      status: 'succeeded',
    });
    expect(output).toEqual({ paymentState: 'succeeded' });
  });
});
