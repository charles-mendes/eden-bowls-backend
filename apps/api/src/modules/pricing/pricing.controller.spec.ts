import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

describe('PricingController', () => {
  let service: {
    calculatePlan: jest.Mock;
    adminListPricing: jest.Mock;
    adminCreatePricing: jest.Mock;
  };
  let controller: PricingController;

  beforeEach(() => {
    service = {
      calculatePlan: jest.fn(),
      adminListPricing: jest.fn(),
      adminCreatePricing: jest.fn(),
    };
    controller = new PricingController(service as unknown as PricingService);
  });

  it('calculatePlan should delegate to service', async () => {
    service.calculatePlan.mockResolvedValue({ total: 123 });

    const output = await controller.calculatePlan({ market: 'BR', currency: 'BRL', termMonths: 3, pets: [] } as never);

    expect(service.calculatePlan).toHaveBeenCalled();
    expect(output).toEqual({ total: 123 });
  });

  it('adminListPricing should delegate to service', async () => {
    service.adminListPricing.mockResolvedValue({ total: 1 });

    const output = await controller.adminListPricing({ page: 1, perPage: 20 });

    expect(service.adminListPricing).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1 });
  });

  it('adminCreatePricing should delegate to service', async () => {
    service.adminCreatePricing.mockResolvedValue({ id: 'price_1' });

    const output = await controller.adminCreatePricing({ variantId: 'variant_1', currency: 'BRL', regularPrice: 10, source: 'manual' } as never);

    expect(service.adminCreatePricing).toHaveBeenCalled();
    expect(output).toEqual({ id: 'price_1' });
  });
});
