import { Injectable } from '@nestjs/common';

import { ListCategoriesQueryDto } from '../products/dto/list-categories-query.dto';
import { ListProductsQueryDto } from '../products/dto/list-products-query.dto';
import { ListVariantsQueryDto } from '../products/dto/list-variants-query.dto';
import { ListPlansQueryDto } from '../pricing/dto/list-plans-query.dto';
import { PricingService } from '../pricing/pricing.service';
import { ProductsService } from '../products/products.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly productsService: ProductsService,
    private readonly pricingService: PricingService,
  ) {}

  listCategories(query: ListCategoriesQueryDto) {
    return this.productsService.listCategories(query);
  }

  listProducts(query: ListProductsQueryDto) {
    return this.productsService.listProducts(query);
  }

  listProductVariants(productId: string, query: ListVariantsQueryDto) {
    return this.productsService.listProductVariants(productId, query);
  }

  listPlans(query: ListPlansQueryDto) {
    return this.pricingService.listPlans(query);
  }

  getPlanById(planId: string) {
    return this.pricingService.getPlanById(planId);
  }
}
