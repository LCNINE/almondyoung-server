import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts';

import { CoreInventoryModule } from '../inventory/core/inventory.module';
import { SharedModule } from '../inventory/shared/shared.module';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { LibraryModule } from '../library/library.module';

import { SalesOrdersController } from './controllers/sales-orders.controller';
import { OrderEventsConsumer } from './consumers/order-events.consumer';
import { SalesOrdersService } from './services/sales-orders.service';
import { SalesOrderQueryService } from './services/sales-order-query.service';
import { PoliciesService } from './services/policies.service';

@Module({
  imports: [
    // ORDER_STREAM Kafka consumer (group: almondyoung-order-consumer)
    // WMS는 wms-consumer 그룹을 유지하므로 동일 이벤트를 독립적으로 소비
    EventsModule.forConsumerModule({
      streams: [ORDER_STREAM],
      groupId: 'almondyoung-order-consumer',
      enableAutoDLQ: true,
    }),

    // OutboxService (Sales Order 이벤트 발행용)
    CoreInventoryModule,

    // AuditService, MetricsService, ReservationLifecycleService
    SharedModule,

    // ProductSkuMappingService (confirm 시 mapping snapshot 생성)
    ProductMatchingModule,

    // LibraryService (OrderConfirmed/Cancelled 시 디지털 ownership grant/revoke — ADR-0006)
    LibraryModule,
  ],
  controllers: [
    SalesOrdersController,
    OrderEventsConsumer,
  ],
  providers: [
    SalesOrdersService,
    SalesOrderQueryService,
    PoliciesService,
  ],
  exports: [
    SalesOrdersService,      // Fulfillment BC (cancel, merge 시 SO 상태 변경)
    SalesOrderQueryService,  // Fulfillment BC (FO 생성 시 SO/라인 조회)
  ],
})
export class SalesOrderModule {}
