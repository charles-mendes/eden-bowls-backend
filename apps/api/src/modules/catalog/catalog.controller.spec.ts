import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

describe('CatalogController', () => {
  let service: {
    listCategories: jest.Mock;
    listProducts: jest.Mock;
    listProductVariants: jest.Mock;
    listPlans: jest.Mock;
    getPlanById: jest.Mock;
  };
  let controller: CatalogController;

  beforeEach(() => {
    service = {
      listCategories: jest.fn(),
      listProducts: jest.fn(),
      listProductVariants: jest.fn(),
      listPlans: jest.fn(),
      getPlanById: jest.fn(),
    };

    controller = new CatalogController(service as unknown as CatalogService);
  });

  it('listCategories should delegate to service', async () => {
    service.listCategories.mockResolvedValue([{ id: 'cat_1' }]);

    const output = await controller.listCategories({ locale: 'en-US' });

    expect(service.listCategories).toHaveBeenCalledWith({ locale: 'en-US' });
    expect(output).toEqual([{ id: 'cat_1' }]);
  });

  it('listProducts should delegate to service', async () => {
    service.listProducts.mockResolvedValue({ total: 1, items: [] });

    const output = await controller.listProducts({ page: 1, perPage: 20 });

    expect(service.listProducts).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1, items: [] });
  });

  it('listProductVariants should delegate to service', async () => {
    service.listProductVariants.mockResolvedValue({ variants: [] });

    const output = await controller.listProductVariants('prod_1', { market: 'BR' });

    expect(service.listProductVariants).toHaveBeenCalledWith('prod_1', { market: 'BR' });
    expect(output).toEqual({ variants: [] });
  });

  it('listPlans should delegate to service', async () => {
    service.listPlans.mockResolvedValue([{ id: 'plan_1' }]);

    const output = await controller.listPlans({ market: 'BR', currency: 'BRL' });

    expect(service.listPlans).toHaveBeenCalledWith({ market: 'BR', currency: 'BRL' });
    expect(output).toEqual([{ id: 'plan_1' }]);
  });

  it('getPlanById should delegate to service', async () => {
    service.getPlanById.mockResolvedValue({ id: 'plan_1' });

    const output = await controller.getPlanById('plan_1');

    expect(service.getPlanById).toHaveBeenCalledWith('plan_1');
    expect(output).toEqual({ id: 'plan_1' });
  });
});
