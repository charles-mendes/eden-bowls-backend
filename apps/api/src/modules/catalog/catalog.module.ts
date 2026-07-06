import { Module } from '@nestjs/common';

import { PricingModule } from '../pricing/pricing.module';
import { ProductsModule } from '../products/products.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  imports: [ProductsModule, PricingModule],
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}