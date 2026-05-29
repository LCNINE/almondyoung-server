import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { FULFILLMENT_STREAM } from '@packages/event-contracts';

import { CoreInventoryModule } from '../inventory/core/inventory.module';
import { SharedModule } from '../inventory/shared/shared.module';
import { ProductMatchingModule } from '../product-matching/product-matching.module';
import { SalesOrderModule } from '../sales-order/sales-order.module';
import { ProductSellableQuantityModule } from '../inventory/product-sellable-quantity/product-sellable-quantity.module';
import { WarehouseModule } from '../inventory/warehouse/warehouse.module';
import { FulfillmentOrderCreationBacklogModule } from './backlog/fulfillment-order-creation-backlog.module';

// Outbox
import { OutboxService } from './outbox/outbox.service';
import { OutboxDispatcherService } from './outbox/outbox-dispatcher.service';

// Services
import { FulfillmentsService } from './services/fulfillments.service';
import { FulfillmentOrderCreationBacklogWorker } from './services/fulfillment-order-creation-backlog.worker';
import { FulfillmentOrderTransactionService } from './services/fulfillment-order-transaction.service';
import { FulfillmentReservationsFacade } from './services/fulfillment-reservations.facade';
import { AvailabilityService } from './services/availability.service';
import { PoliciesService } from './services/policies.service';
import { OutboundBatchService } from './services/outbound-batch.service';
import { PickingProcessService } from './services/picking-process.service';
import { InspectionService } from './services/inspection.service';
import { ConsolidationService } from './services/consolidation.service';
import { DirectShipService } from './services/direct-ship.service';
import { InvoiceService } from './services/invoice.service';

// Controllers
import { FulfillmentsController } from './controllers/fulfillments.controller';
import { FulfillmentOrderController } from './controllers/fulfillment-order.controller';
import { OutboundBatchController } from './controllers/outbound-batch.controller';
import { PickingController } from './controllers/picking.controller';
import { InspectionController } from './controllers/inspection.controller';
import { ConsolidationController } from './controllers/consolidation.controller';
import { DirectShipController } from './controllers/direct-ship.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { LocationOptimizationController } from './controllers/location-optimization.controller';

@Module({
  imports: [
    // FULFILLMENT_STREAM Kafka producer (OutboxDispatcherService가 발행)
    // INVENTORY_STREAM publisher는 InventoryModule이 전역으로 등록
    EventsModule.forRoot({
      streams: [FULFILLMENT_STREAM],
      serviceName: 'almondyoung',
      enableDLQ: true,
    }),

    // DbService, OutboxService(core), ScheduleModule, StockEventService
    CoreInventoryModule,

    // BarcodeService, ReservationLifecycleService, UnifiedReservationService, AuditService
    SharedModule,

    // ProductSkuMappingService (FO 생성 시 SKU 조회 + 스냅샷)
    ProductMatchingModule,

    // SalesOrdersService (SO 취소), SalesOrderQueryService (SO/라인 조회)
    SalesOrderModule,

    ProductSellableQuantityModule,

    WarehouseModule,
    FulfillmentOrderCreationBacklogModule,
  ],
  controllers: [
    FulfillmentsController,
    FulfillmentOrderController,
    OutboundBatchController,
    PickingController,
    InspectionController,
    ConsolidationController,
    DirectShipController,
    InvoiceController,
    LocationOptimizationController,
  ],
  providers: [
    // Outbox
    OutboxService,
    OutboxDispatcherService,

    // Core fulfillment services
    FulfillmentsService,
    FulfillmentOrderCreationBacklogWorker,
    FulfillmentOrderTransactionService,
    FulfillmentReservationsFacade,
    AvailabilityService,
    PoliciesService,

    // Outbound process services
    OutboundBatchService,
    PickingProcessService,
    InspectionService,
    ConsolidationService,
    DirectShipService,
    InvoiceService,
  ],
})
export class FulfillmentModule {}
