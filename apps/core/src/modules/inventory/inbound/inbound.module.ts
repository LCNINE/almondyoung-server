import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SkuCatalogModule } from '../sku-catalog/sku-catalog.module';
import { SharedModule } from '../shared/shared.module';
import { PURCHASE_ORDER_CLOSURE } from '../shared/ports/purchase-order-closure.port';
import { PurchaseOrderClosureAdapter } from '../procurement/services/purchase-order-closure.adapter';
import { InboundController } from './controllers/inbound.controllers';
import { InboundService } from './services/inbound.service';
import { InboundPutawayReader } from './services/inbound-putaway.reader';

@Module({
  imports: [CoreInventoryModule, SkuCatalogModule, SharedModule],
  controllers: [InboundController],
  providers: [
    InboundService,
    InboundPutawayReader,
    // 어댑터 파일은 procurement/ 에 살지만 등록은 여기서 한다 — ProcurementModule 을
    // import 하면 모듈 순환이 생긴다(procurement 가 이미 InboundModule 을 import 한다).
    // 클래스 파일 하나만 가리키므로 순환이 아니고 forwardRef 도 필요 없다.
    { provide: PURCHASE_ORDER_CLOSURE, useClass: PurchaseOrderClosureAdapter },
  ],
  exports: [InboundService],
})
export class InboundModule {}
