import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  let productsService: {
    listCategories: jest.Mock;
    listProducts: jest.Mock;
    listProductVariants: jest.Mock;
  };
  let pricingService: {
    listPlans: jest.Mock;
    getPlanById: jest.Mock;
  };
  let service: CatalogService;

  beforeEach(() => {
    productsService = {
      listCategories: jest.fn(),
      listProducts: jest.fn(),
      listProductVariants: jest.fn(),
    };
    pricingService = {
      listPlans: jest.fn(),
      getPlanById: jest.fn(),
    };

    service = new CatalogService(productsService as never, pricingService as never);
  });

  it('listCategories should delegate to products service', async () => {
    productsService.listCategories.mockResolvedValue([{ id: 'cat_1' }]);

    const output = await service.listCategories({ locale: 'pt-BR' });

    expect(productsService.listCategories).toHaveBeenCalledWith({ locale: 'pt-BR' });
    expect(output).toEqual([{ id: 'cat_1' }]);
  });

  it('listProducts should delegate to products service', async () => {
    productsService.listProducts.mockResolvedValue({ total: 1, items: [] });

    const output = await service.listProducts({ page: 1, perPage: 20 });

    expect(productsService.listProducts).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1, items: [] });
  });

  it('listProductVariants should delegate to products service', async () => {
    productsService.listProductVariants.mockResolvedValue({ variants: [] });

    const output = await service.listProductVariants('prod_1', { currency: 'BRL' });

    expect(productsService.listProductVariants).toHaveBeenCalledWith('prod_1', { currency: 'BRL' });
    expect(output).toEqual({ variants: [] });
  });

  it('listPlans should delegate to pricing service', async () => {
    pricingService.listPlans.mockResolvedValue([{ id: 'plan_1' }]);

    const output = await service.listPlans({ market: 'BR', currency: 'BRL' });

    expect(pricingService.listPlans).toHaveBeenCalledWith({ market: 'BR', currency: 'BRL' });
    expect(output).toEqual([{ id: 'plan_1' }]);
  });

  it('getPlanById should delegate to pricing service', async () => {
    pricingService.getPlanById.mockResolvedValue({ id: 'plan_1' });

    const output = await service.getPlanById('plan_1');

    expect(pricingService.getPlanById).toHaveBeenCalledWith('plan_1');
    expect(output).toEqual({ id: 'plan_1' });
  });
});
