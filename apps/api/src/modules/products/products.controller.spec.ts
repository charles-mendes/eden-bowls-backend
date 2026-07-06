import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

describe('ProductsController', () => {
  let service: {
    adminListProducts: jest.Mock;
    adminCreateProduct: jest.Mock;
    adminUpdateProduct: jest.Mock;
  };
  let controller: ProductsController;

  beforeEach(() => {
    service = {
      adminListProducts: jest.fn(),
      adminCreateProduct: jest.fn(),
      adminUpdateProduct: jest.fn(),
    };
    controller = new ProductsController(service as unknown as ProductsService);
  });

  it('adminListProducts should delegate to service', async () => {
    service.adminListProducts.mockResolvedValue({ total: 1 });

    const output = await controller.adminListProducts({ page: 1, perPage: 20 });

    expect(service.adminListProducts).toHaveBeenCalledWith({ page: 1, perPage: 20 });
    expect(output).toEqual({ total: 1 });
  });

  it('adminCreateProduct should delegate to service', async () => {
    service.adminCreateProduct.mockResolvedValue({ productId: 'prod_1' });

    const output = await controller.adminCreateProduct({ categoryId: 'cat_1', slug: 'slug', namePt: 'Nome', nameEn: 'Name' } as never);

    expect(service.adminCreateProduct).toHaveBeenCalled();
    expect(output).toEqual({ productId: 'prod_1' });
  });

  it('adminUpdateProduct should delegate to service', async () => {
    service.adminUpdateProduct.mockResolvedValue({ id: 'prod_1' });

    const output = await controller.adminUpdateProduct('prod_1', { active: true });

    expect(service.adminUpdateProduct).toHaveBeenCalledWith('prod_1', { active: true });
    expect(output).toEqual({ id: 'prod_1' });
  });
});
