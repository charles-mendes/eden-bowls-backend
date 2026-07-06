import { Controller, Get, Param, Query } from '@nestjs/common';

import { ListCategoriesQueryDto } from '../products/dto/list-categories-query.dto';
import { ListProductsQueryDto } from '../products/dto/list-products-query.dto';
import { ListVariantsQueryDto } from '../products/dto/list-variants-query.dto';
import { ListPlansQueryDto } from '../pricing/dto/list-plans-query.dto';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('catalog/categories')
  listCategories(@Query() query: ListCategoriesQueryDto) {
    return this.catalogService.listCategories(query);
  }

  @Get('catalog/products')
  listProducts(@Query() query: ListProductsQueryDto) {
    return this.catalogService.listProducts(query);
  }

  @Get('catalog/products/:productId/variants')
  listProductVariants(
    @Param('productId') productId: string,
    @Query() query: ListVariantsQueryDto,
  ) {
    return this.catalogService.listProductVariants(productId, query);
  }

  @Get('catalog/plans')
  listPlans(@Query() query: ListPlansQueryDto) {
    return this.catalogService.listPlans(query);
  }

  @Get('catalog/plans/:planId')
  getPlanById(@Param('planId') planId: string) {
    return this.catalogService.getPlanById(planId);
  }
}
