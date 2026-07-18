import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '../shared/shared.module';
import { ProductSellableQuantityModule } from '../product-sellable-quantity/product-sellable-quantity.module';

// Controllers (Phase 3 scope — product-matching is Phase 4)
import { InventoryController } from './controllers/inventory.controller';
import { LocationController } from './controllers/location.controller';
import { SkuManagersController, ManagerSkusController } from './controllers/sku-managers.controller';
import { ReservationController } from './controllers/reservation.controller';
import { ReturnController } from './controllers/return.controller';
import { TransferController } from './controllers/transfer.controller';
import { HolderController } from './controllers/holder.controller';
import { LedgerReconciliationController } from './controllers/ledger-reconciliation.controller';

// Services
import { StockEventService } from './services/stock-event.service';
import { SafetyStockService } from './services/safety-stock.service';
import { LocationService } from './services/location.service';
import { InventoryCommandService } from './services/inventory-command.service';
import { InventoryQueryService } from './services/inventory-query.service';
import { SkuManagersService } from './services/sku-managers.service';
import { FifoLocationStrategy, LOCATION_RESOLUTION_STRATEGY } from './services/location-resolution.strategy';
import { LedgerReconciliationService } from './services/ledger-reconciliation.service';
import { FulfillmentReservationReconciliationService } from './services/fulfillment-reservation-reconciliation.service';
import { InventoryIdempotencyService } from './services/inventory-idempotency.service';
import { ReturnService } from './services/return.service';
import { TransferService } from './services/transfer.service';
import { HolderService } from './services/holder.service';
import { BatchControlledStockGuard } from './services/batch-controlled-stock.guard';

// Repository
import { StockEventStore } from './repositories/stock-event.store';

// Outbox (temporary — moves to Fulfillment BC in Phase 6)
import { OutboxService } from '../shared/outbox/outbox.service';

@Module({
  imports: [ScheduleModule.forRoot(), SharedModule, ProductSellableQuantityModule],
  controllers: [
    InventoryController,
    LocationController,
    SkuManagersController,
    ManagerSkusController,
    ReservationController,
    ReturnController,
    TransferController,
    HolderController,
    LedgerReconciliationController,
  ],
  providers: [
    StockEventService,
    SafetyStockService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    SkuManagersService,
    { provide: LOCATION_RESOLUTION_STRATEGY, useClass: FifoLocationStrategy },
    LedgerReconciliationService,
    FulfillmentReservationReconciliationService,
    InventoryIdempotencyService,
    ReturnService,
    TransferService,
    HolderService,
    BatchControlledStockGuard,
    OutboxService,
  ],
  exports: [
    StockEventService,
    SafetyStockService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    SkuManagersService,
    LOCATION_RESOLUTION_STRATEGY,
    ReturnService,
    TransferService,
    HolderService,
    BatchControlledStockGuard,
    InventoryIdempotencyService,
    OutboxService,
  ],
})
export class CoreInventoryModule {}
