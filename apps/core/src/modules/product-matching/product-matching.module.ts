import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../inventory/core/inventory.module';
import { WarehouseModule } from '../inventory/warehouse/warehouse.module';
import { SkuCatalogModule } from '../inventory/sku-catalog/sku-catalog.module';
import { ProductSellableQuantityModule } from '../inventory/product-sellable-quantity/product-sellable-quantity.module';
import { ProductMatchingController } from './controllers/product-matching.controller';
import { ProductSkuMappingController } from './controllers/product-sku-mapping.controller';
import { ProductMatchingService } from './services/product-matching.service';
import { ProductSkuMappingService } from './services/product-sku-mapping.service';

@Module({
  imports: [
    CoreInventoryModule, // StockEventService 의존
    WarehouseModule, // WarehouseService 의존
    SkuCatalogModule, // SkuCatalogService 의존
    ProductSellableQuantityModule,
  ],
  controllers: [ProductMatchingController, ProductSkuMappingController],
  providers: [ProductMatchingService, ProductSkuMappingService],
  exports: [
    ProductMatchingService, // Catalog BC (variant 생성 시 직접 호출)
    ProductSkuMappingService, // Fulfillment BC (FO 생성 시 SKU 조회 + 스냅샷)
  ],
})
export class ProductMatchingModule {}
