import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
// 출발 창고 수령이 이동 지시서 초안을 만든다. 반대 방향(이동 → 입고) 참조는 없으므로
// 순환이 아니다 — WarehouseTransferModule 은 InboundModule 을 모른다.
import { WarehouseTransferModule } from '../warehouse-transfer/warehouse-transfer.module';
import { InboundController } from './controllers/inbound.controllers';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseOrderCronService } from './services/purchase-order-cron.service';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule, WarehouseTransferModule],
  controllers: [InboundController, PurchaseOrderController],
  providers: [InboundService, InboundPutawayReader, PurchaseOrderService, PurchaseOrderCronService],
  exports: [InboundService, PurchaseOrderService],
})
export class InboundModule {}
