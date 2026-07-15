import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import {
  FULFILLMENT_STREAM,
  CORE_ORDER_STREAM,
  SHIPMENT_STREAM,
  FULFILLMENT_V2_STREAM,
} from '@packages/event-contracts';

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
import { OutboundConsumptionService } from './services/outbound-consumption.service';
import { FulfillmentOrderCreationBacklogWorker } from './services/fulfillment-order-creation-backlog.worker';
import { FulfillmentOrderReservationRetryWorker } from './services/fulfillment-order-reservation-retry.worker';
import { FulfillmentOrderTransactionService } from './services/fulfillment-order-transaction.service';
import { FulfillmentReservationsFacade } from './services/fulfillment-reservations.facade';
import { AvailabilityService } from './services/availability.service';
import { PoliciesService } from './services/policies.service';
import { OutboundBatchService } from './services/outbound-batch.service';
import { PickingProcessService } from './services/picking-process.service';
import { ShipmentService } from './services/shipment.service';
import { ConsolidationService } from './services/consolidation.service';
import { DirectShipService } from './services/direct-ship.service';
import { InvoiceService } from './services/invoice.service';
import { GoodsflowDeliveryProvider } from './services/goodsflow-delivery.provider';
import { HanjinDeliveryProvider } from './services/hanjin-delivery.provider';
import { FulfillmentProgressService } from './services/fulfillment-progress.service';
import { FulfillmentInvariantService } from './services/fulfillment-invariant.service';
import { FulfillmentReconciliationService } from './services/fulfillment-reconciliation.service';
import { ShipmentReservationService } from './services/shipment-reservation.service';
import { FulfillmentCommandService } from './services/fulfillment-command.service';
import { ShipmentPlanningService } from './services/shipment-planning.service';
import { InvoiceOrchestrator } from './services/invoice-orchestrator.service';
import { InvoiceRecoveryWorker } from './services/invoice-recovery.worker';
import { OutboundBatchOrchestrator } from './services/outbound-batch-orchestrator.service';
import { BatchInventorySessionService } from './services/batch-inventory-session.service';
import { BatchSessionRecoveryService } from './services/batch-session-recovery.service';
import { DiscretePickingStrategy } from './picking/discrete-picking.strategy';
import { PICKING_STRATEGIES, PickingStrategyRegistry } from './picking/picking-strategy.registry';
import { AggregateThenSortPickingStrategy } from './picking/aggregate-then-sort.strategy';
import { PickToTotePickingStrategy } from './picking/pick-to-tote.strategy';
import { ShipmentDispatchService } from './services/shipment-dispatch.service';
import { ShipmentDeliveryTrackingService } from './services/shipment-delivery-tracking.service';
import { ShipmentShortPickService } from './services/shipment-short-pick.service';
import { ToteLifecycleService } from './services/tote-lifecycle.service';
import { ShipmentRecallService } from './services/shipment-recall.service';

// Controllers
import { FulfillmentsController } from './controllers/fulfillments.controller';
import { FulfillmentOrderController } from './controllers/fulfillment-order.controller';
import { OutboundBatchController } from './controllers/outbound-batch.controller';
import { PickingController } from './controllers/picking.controller';
import { ShipmentController } from './controllers/shipment.controller';
import { ConsolidationController } from './controllers/consolidation.controller';
import { DirectShipController } from './controllers/direct-ship.controller';
import { InvoiceController } from './controllers/invoice.controller';
import { LocationOptimizationController } from './controllers/location-optimization.controller';
import { FulfillmentOperationController, ShipmentPlanningController } from './controllers/shipment-planning.controller';
import { ShipmentInvoiceController } from './controllers/shipment-invoice.controller';
import { OutboundBatchV2Controller } from './controllers/outbound-batch-v2.controller';
import { PickingCommandV2Controller, PickingV2Controller } from './controllers/picking-v2.controller';
import { ToteController } from './controllers/tote.controller';
import { ShipmentTrackingController } from './controllers/shipment-tracking.controller';
import { ShipmentShortPickController } from './controllers/shipment-short-pick.controller';
import { ShipmentRecallController, ShipmentRecallOperationController } from './controllers/shipment-recall.controller';

@Module({
  imports: [
    // FULFILLMENT_STREAM Kafka producer (OutboxDispatcherService가 발행)
    // INVENTORY_STREAM publisher는 InventoryModule이 전역으로 등록
    EventsModule.forRoot({
      streams: [FULFILLMENT_STREAM, CORE_ORDER_STREAM, SHIPMENT_STREAM, FULFILLMENT_V2_STREAM],
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
    // Static V2 outbound-batch routes must be registered before the legacy `:id` reader.
    OutboundBatchV2Controller,
    PickingV2Controller,
    PickingCommandV2Controller,
    ToteController,
    OutboundBatchController,
    PickingController,
    ShipmentController,
    ConsolidationController,
    DirectShipController,
    InvoiceController,
    LocationOptimizationController,
    ShipmentPlanningController,
    FulfillmentOperationController,
    ShipmentInvoiceController,
    ShipmentTrackingController,
    ShipmentShortPickController,
    ShipmentRecallController,
    ShipmentRecallOperationController,
  ],
  providers: [
    // Outbox
    OutboxService,
    OutboxDispatcherService,

    // Core fulfillment services
    FulfillmentsService,
    OutboundConsumptionService,
    FulfillmentOrderCreationBacklogWorker,
    FulfillmentOrderReservationRetryWorker,
    FulfillmentOrderTransactionService,
    FulfillmentReservationsFacade,
    AvailabilityService,
    PoliciesService,

    // Outbound process services
    OutboundBatchService,
    PickingProcessService,
    ShipmentService,
    ShipmentDispatchService,
    ShipmentDeliveryTrackingService,
    ShipmentShortPickService,
    ShipmentRecallService,
    ToteLifecycleService,
    ConsolidationService,
    DirectShipService,
    InvoiceService,
    GoodsflowDeliveryProvider,
    HanjinDeliveryProvider,
    FulfillmentProgressService,
    FulfillmentInvariantService,
    FulfillmentReconciliationService,
    ShipmentReservationService,
    FulfillmentCommandService,
    ShipmentPlanningService,
    InvoiceOrchestrator,
    InvoiceRecoveryWorker,
    OutboundBatchOrchestrator,
    BatchInventorySessionService,
    BatchSessionRecoveryService,
    DiscretePickingStrategy,
    AggregateThenSortPickingStrategy,
    PickToTotePickingStrategy,
    {
      provide: PICKING_STRATEGIES,
      useFactory: (
        discrete: DiscretePickingStrategy,
        aggregateThenSort: AggregateThenSortPickingStrategy,
        pickToTote: PickToTotePickingStrategy,
      ) => [discrete, aggregateThenSort, pickToTote],
      inject: [DiscretePickingStrategy, AggregateThenSortPickingStrategy, PickToTotePickingStrategy],
    },
    PickingStrategyRegistry,
  ],
  exports: [
    FulfillmentProgressService,
    FulfillmentInvariantService,
    FulfillmentReconciliationService,
    ShipmentReservationService,
    FulfillmentCommandService,
    ShipmentPlanningService,
    InvoiceOrchestrator,
    OutboundBatchOrchestrator,
    BatchInventorySessionService,
    BatchSessionRecoveryService,
    DiscretePickingStrategy,
    AggregateThenSortPickingStrategy,
    PickToTotePickingStrategy,
    PickingStrategyRegistry,
  ],
})
export class FulfillmentModule {}
