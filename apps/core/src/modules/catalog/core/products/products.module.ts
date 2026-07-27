import { Module, forwardRef } from '@nestjs/common';
import { ProductMastersController } from './controllers/product-masters.controller';
import { ProductVariantsController } from './controllers/product-variants.controller';
import { ProductMasterVersionsController } from './controllers/product-master-versions.controller';
import { ProductPurchaseConstraintsController } from './controllers/product-purchase-constraints.controller';
import { ProductMastersService } from './services/product-masters.service';
import { ProductVariantsService } from './services/product-variants.service';
import { ProductVersionsService } from './services/product-versions.service';
import { ProductPurchaseConstraintsService } from './services/product-purchase-constraints.service';
import { PricingModule } from '../pricing/pricing.module';
import { ProductVersionsController } from './controllers/product-versions.controller';
import { ProductReadAssembler } from './assemblers/product-read.assembler';
import { ProjectionSnapshotAssembler } from './assemblers/projection-snapshot.assembler';
import { OptionReadLoader } from './loaders/option-read.loader';
import { ProductVersionReadLoader } from './loaders/product-version-read.loader';
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
    ProductPurchaseConstraintsController,
  ],
  providers: [
    ProductMastersService,
    ProductVariantsService,
    ProductVersionsService,
    ProductPurchaseConstraintsService,
    ProductReadAssembler,
    ProjectionSnapshotAssembler,
    OptionReadLoader,
    ProductVersionReadLoader,
    TagReadLoader,
  ],
  exports: [
    ProductMastersService,
    ProductVariantsService,
    ProductVersionsService,
    ProductPurchaseConstraintsService,
    ProductReadAssembler,
    // 카테고리 서비스가 상품-카테고리 변경 시 프로젝션 스냅샷을 재발행하는 데 사용한다.
    ProjectionSnapshotAssembler,
  ],
})
export class ProductsModule {}
