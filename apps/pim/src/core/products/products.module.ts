import { Module } from '@nestjs/common';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductMasterVersionsController } from './controllers/product-master-versions.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsService } from './services/product-variants.service';
import { ProductSearchService } from './services/product-search.service';
import { ProductVersionsService } from './services/product-versions.service';
import { PricingModule } from '../pricing/pricing.module';
import { ProductVersionsController } from './controllers/product-versions.controller';

@Module({
  imports: [PricingModule],
  controllers: [
    ProductMastersController,
    ProductVariantsController,
    ProductMasterVersionsController,
    ProductVersionsController,
  ],
  providers: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
    ProductVersionsService,
  ],
  exports: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
    ProductVersionsService,
  ],
})
export class ProductsModule { }

