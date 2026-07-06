import { ShippingController } from './shipping.controller';
import { ShippingService } from './shipping.service';

describe('ShippingController', () => {
  let service: {
    createQuote: jest.Mock;
    selectRate: jest.Mock;
  };
  let controller: ShippingController;

  beforeEach(() => {
    service = {
      createQuote: jest.fn(),
      selectRate: jest.fn(),
    };
    controller = new ShippingController(service as unknown as ShippingService);
  });

  it('createQuote should delegate to ShippingService.createQuote', async () => {
    service.createQuote.mockResolvedValue({ quoteId: 'quote_1' });

    const output = await controller.createQuote('session_1', {
      destination: { country: 'BR', postcode: '01000-000' },
      items: [{ quantity: 1, unitPrice: 100 }],
    });

    expect(service.createQuote).toHaveBeenCalledWith('session_1', {
      destination: { country: 'BR', postcode: '01000-000' },
      items: [{ quantity: 1, unitPrice: 100 }],
    });
    expect(output).toEqual({ quoteId: 'quote_1' });
  });

  it('selectRate should delegate to ShippingService.selectRate', async () => {
    service.selectRate.mockResolvedValue({ selectedShipping: { quoteId: 'quote_1' } });

    const output = await controller.selectRate('session_1', {
      quoteId: 'quote_1',
      rateId: 'rate_1',
    });

    expect(service.selectRate).toHaveBeenCalledWith('session_1', {
      quoteId: 'quote_1',
      rateId: 'rate_1',
    });
    expect(output).toEqual({ selectedShipping: { quoteId: 'quote_1' } });
  });
});
