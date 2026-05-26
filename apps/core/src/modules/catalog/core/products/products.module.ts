import { Module, forwardRef } from '@nestjs/common';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductMasterVersionsController } from './controllers/product-master-versions.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsService } from './services/product-variants.service';
import { ProductSearchService } from './services/product-search.service';
import { ProductVersionsService } from './services/product-versions.service';
import { PricingModule } from '../pricing/pricing.module';
import { ProductVersionsController } from './controllers/product-versions.controller';
import { ProductReadAssembler } from './assemblers/product-read.assembler';
import { OptionReadLoader } from './loaders/option-read.loader';
import { TagReadLoader } from './loaders/tag-read.loader';
import { ProductMatchingModule } from '../../../product-matching/product-matching.module';
import { LibraryModule } from '../../../library/library.module';
import { ProductSellableQuantityModule } from '../../../inventory/product-sellable-quantity/product-sellable-quantity.module';

@Module({
  imports: [PricingModule, forwardRef(() => ProductMatchingModule), LibraryModule, ProductSellableQuantityModule],
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
    ProductReadAssembler,
    OptionReadLoader,
    TagReadLoader,
  ],
  exports: [
    ProductMastersService,
    ProductVariantsService,
    ProductSearchService,
    ProductVersionsService,
    ProductReadAssembler,
  ],
})
export class ProductsModule {}
