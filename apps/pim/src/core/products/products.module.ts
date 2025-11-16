import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsService } from './services/product-variants.service';
import { ProductSearchService } from './services/product-search.service';

@Module({
  imports: [],
  controllers: [ProductMastersController, ProductVariantsController],
  providers: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
  ],
  exports: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
  ],
})
export class ProductsModule {}

