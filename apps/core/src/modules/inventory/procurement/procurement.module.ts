import { Module } from '@nestjs/common';
import { CoreInventoryModule } from '../core/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { InboundModule } from '../inbound/inbound.module';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseOrderCartService } from './services/purchase-order-cart.service';
import { PurchaseOrderReader } from './services/purchase-order.reader';
import { PurchaseOrderManager } from './services/purchase-order.manager';
import { PurchaseOrderHeaderDeriver } from './services/purchase-order-header.deriver';
import { PurchaseOrderReceivingManager } from './services/purchase-order-receiving.manager';
import { PurchaseOrderExpectedArrivalReader } from './services/purchase-order-expected-arrival.reader';

/**
 * 조달(발주) 모듈. 경계는 ADR-0039 「문서가 수령 정산을 소유하고, 현장 입고는 공통 커널이 한다」가 소유한다.
 *
 * - 발주는 공급사 → 출발 창고 수령 정산을 소유한다. `received` 는 출발 창고에서 더 받을 수량이 없다는 뜻이다.
 * - 발주 라인이 수령 상태를 소유하며 헤더 상태는 `PurchaseOrderHeaderDeriver` 한 경로에서
 *   라인 카운터로 파생된다.
 * - `warehouse-transfer/` 를 import 하지 않는다. 출발 창고 → 도착 창고 선적은 이동
 *   지시서가 독립 소유하며 발주와 링크하지 않는다. **제품 코드 0곳**이고 0곳으로 유지한다.
 *   (`purchase-order-line-execution.integration.spec.ts` 하나가 `WarehouseTransferReader`
 *   를 import 하는데, 그건 라인 실행 후 공급 파이프라인 숫자를 검증하는 **스펙**이지
 *   런타임 의존이 아니다 — grep 이 걸려도 위반이 아니다.)
 */
@Module({
  imports: [CoreInventoryModule, SharedModule, InboundModule],
  controllers: [PurchaseOrderController],
  providers: [
    PurchaseOrderService,
    PurchaseOrderCartService,
    PurchaseOrderReader,
    PurchaseOrderManager,
    PurchaseOrderHeaderDeriver,
    PurchaseOrderReceivingManager,
    PurchaseOrderExpectedArrivalReader,
  ],
  exports: [
    PurchaseOrderService,
    PurchaseOrderCartService,
    PurchaseOrderReader,
    PurchaseOrderManager,
    PurchaseOrderHeaderDeriver,
    PurchaseOrderReceivingManager,
    PurchaseOrderExpectedArrivalReader,
  ],
})
export class ProcurementModule {}
