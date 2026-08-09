import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts';

import { CoreInventoryModule } from '../inventory/core/inventory.module';
import { SharedModule } from '../inventory/shared/shared.module';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { LibraryModule } from '../library/library.module';
import { ProductSellableQuantityModule } from '../inventory/product-sellable-quantity/product-sellable-quantity.module';
import { FulfillmentOrderCreationBacklogModule } from '../fulfillment/backlog/fulfillment-order-creation-backlog.module';

import { SalesOrdersController } from './controllers/sales-orders.controller';
import { SalesOrderAmendmentsController } from './controllers/sales-order-amendments.controller';
import { StoreSalesOrdersController } from './controllers/store-sales-orders.controller';
import { StoreSalesOrderReturnExchangeController } from './controllers/store-return-exchange.controller';
import { AdminReturnExchangeController } from './controllers/admin-return-exchange.controller';
import { OrderEventsConsumer } from './consumers/order-events.consumer';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesOrderAmendmentsService } from './services/sales-order-amendments.service';
import { SalesOrderQueryService } from './services/sales-order-query.service';
import { PoliciesService } from './services/policies.service';
import { StoreSalesOrdersService } from './services/store-sales-orders.service';
import { StoreReturnExchangeService } from './services/store-return-exchange.service';
import { WalletRefundClient } from './services/wallet-refund.client';

@Module({
  imports: [
    // ORDER_STREAM Kafka consumer (group: almondyoung-order-consumer)
    // WMS는 wms-consumer 그룹을 유지하므로 동일 이벤트를 독립적으로 소비
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'almondyoung-order-consumer',
      enableAutoDLQ: true,
      // ⚠️ 이 `false` 는 **현상 유지**이지 새 결정이 아니다. 이 앱은 하이브리드
      // connectMicroservice 때문에 소비 경로에 스키마 검증이 붙은 적이 없다
      // (ADR-0029 §8). main.ts 가 startConsumer 로 옮겨가면서 인터셉터가 처음으로
      // 붙으므로, 명시하지 않으면 기본값 `true` 가 먹어 배선 이주와 검증 활성화가
      // 한 배포에 같이 켜진다. 검증을 켜는 것은 인바운드 payload 를 샘플링한 뒤
      // 별도로 내리는 결정이다 (플랜 Task 5-C).
      validation: { validateOnConsume: false },
    }),

    // OutboxService (Sales Order 이벤트 발행용)
    CoreInventoryModule,

    // AuditService, MetricsService, ReservationLifecycleService
    SharedModule,

    // ProductSkuMappingService (confirm 시 mapping snapshot 생성)
    ProductMatchingModule,

    // LibraryService (OrderCreated(payment-confirmed)/Cancelled 시 디지털 ownership grant/revoke — ADR-0010)
    LibraryModule,

    // OrderCreated 처리 후 출고주문 생성 시도를 durable backlog 로 기록 — ADR-0014
    FulfillmentOrderCreationBacklogModule,

    ProductSellableQuantityModule,
  ],
  controllers: [SalesOrdersController, SalesOrderAmendmentsController, StoreSalesOrdersController, StoreSalesOrderReturnExchangeController, AdminReturnExchangeController, OrderEventsConsumer],
  providers: [SalesOrdersService, SalesOrderAmendmentsService, SalesOrderQueryService, PoliciesService, StoreSalesOrdersService, StoreReturnExchangeService, WalletRefundClient],
  exports: [
    SalesOrdersService, // Fulfillment BC (cancel, merge 시 SO 상태 변경)
    SalesOrderAmendmentsService,
    SalesOrderQueryService, // Fulfillment BC (FO 생성 시 SO/라인 조회)
  ],
})
export class SalesOrderModule {}
