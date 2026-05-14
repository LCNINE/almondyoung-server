import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { InboundService } from './services/inbound.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseOrderCronService } from './services/purchase-order-cron.service';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController, PurchaseOrderController],
  providers: [InboundService, PurchaseOrderService, PurchaseOrderCronService],
  exports: [InboundService, PurchaseOrderService],
})
export class InboundModule {}
