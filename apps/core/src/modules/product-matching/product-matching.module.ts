import { Module } from '@nestjs/common';
import { SkuCatalogModule } from '../inventory/sku-catalog/sku-catalog.module';
import { ProductSellableQuantityModule } from '../inventory/product-sellable-quantity/product-sellable-quantity.module';
import { FulfillmentOrderCreationBacklogModule } from '../fulfillment/backlog/fulfillment-order-creation-backlog.module';
import { SharedModule } from '../inventory/shared/shared.module';
import { ProductMatchingController } from './controllers/product-matching.controller';
import { ProductSkuMappingController } from './controllers/product-sku-mapping.controller';
import { ProductMatchingService } from './services/product-matching.service';
import { ProductSkuMappingService } from './services/product-sku-mapping.service';
import { MatchingLinkResolver } from './services/matching-link-resolver';
import { LineCompositionReader } from './line-composition/line-composition.reader';
import { LineCompositionManager } from './line-composition/line-composition.manager';

@Module({
  imports: [
    SkuCatalogModule, // SkuCatalogService 의존
    ProductSellableQuantityModule,
    FulfillmentOrderCreationBacklogModule,
    SharedModule, // AuditService 의존
  ],
  controllers: [ProductMatchingController, ProductSkuMappingController],
  providers: [
    ProductMatchingService,
    ProductSkuMappingService,
    MatchingLinkResolver,
    LineCompositionReader,
    LineCompositionManager,
  ],
  exports: [
    ProductMatchingService, // Catalog BC (variant 생성 시 직접 호출)
    ProductSkuMappingService, // Fulfillment BC (FO 생성 시 SKU 조회 + 스냅샷)
    LineCompositionReader, // Fulfillment BC (FO 생성·리컨실러가 라인 구성 판정)
    LineCompositionManager, // Fulfillment BC (FO 생성이 라인 구성을 굳힌다)
  ],
})
export class ProductMatchingModule {}
