import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminCreateProductDto } from './dto/admin-create-product.dto';
import { AdminListProductsQueryDto } from './dto/admin-list-products-query.dto';
import { AdminUpdateProductDto } from './dto/admin-update-product.dto';
import { ProductsService } from './products.service';

@Controller()
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get('admin/catalog/products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator', 'readonly')
  adminListProducts(@Query() query: AdminListProductsQueryDto) {
    return this.productsService.adminListProducts(query);
  }

  @Post('admin/catalog/products')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  adminCreateProduct(@Body() body: AdminCreateProductDto) {
    return this.productsService.adminCreateProduct(body);
  }

  @Patch('admin/catalog/products/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('admin', 'operator')
  adminUpdateProduct(@Param('id') id: string, @Body() body: AdminUpdateProductDto) {
    return this.productsService.adminUpdateProduct(id, body);
  }
}
