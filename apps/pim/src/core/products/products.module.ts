import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductVersionsController } from './controllers/product-versions.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsService } from './services/product-variants.service';
import { ProductSearchService } from './services/product-search.service';
import { ProductVersionsService } from './services/product-versions.service';

@Module({
  imports: [],
  controllers: [
    ProductMastersController,
    ProductVariantsController,
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
export class ProductsModule {}

