import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { PURCHASE_ORDER_CLOSURE } from '../shared/ports/purchase-order-closure.port';
import { InboundController } from './controllers/inbound.controllers';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';
import { InboundReceiptKernel } from './kernel/inbound-receipt.kernel';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController],
  providers: [
    InboundService,
    InboundPutawayReader,
    InboundReceiptKernel,
    // Task 6 에서 InboundService 와 함께 포트 자체를 제거한다.
    { provide: PURCHASE_ORDER_CLOSURE, useValue: { onPlanClosed: async () => undefined } },
  ],
  exports: [InboundService, InboundReceiptKernel],
})
export class InboundModule {}
