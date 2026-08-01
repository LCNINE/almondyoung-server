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
    // 대량등록이 조합 문자열 → variantId 해석에 사용한다 (엑셀에 UUID 가 없으므로
    // 옵션 표시명으로 variant 를 찾아야 한다).
    OptionReadLoader,
    // bulk-session 의 FormExportSnapshotReader 가 마스터의 active 버전(옵션·variant·카테고리·
    // 이미지·구매제약 포함)을 읽는 데 쓴다. export 되지 않으면 BulkSessionModule 이
    // ProductsModule 을 import 해도 이 provider 는 못 보여 DI 가 부팅 시점에 깨진다.
    ProductVersionReadLoader,
  ],
})
export class ProductsModule {}
