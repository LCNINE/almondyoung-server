import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '../shared/shared.module';
import { ProductSellableQuantityModule } from '../product-sellable-quantity/product-sellable-quantity.module';

// Controllers (Phase 3 scope — product-matching is Phase 4)
import { InventoryController } from './controllers/inventory.controller';
import { LocationController } from './controllers/location.controller';
import { SkuManagersController, ManagerSkusController } from './controllers/sku-managers.controller';
import { SkuLocationMovementController } from './controllers/sku-location-movement.controller';
import { ReservationController } from './controllers/reservation.controller';
import { ReturnController } from './controllers/return.controller';
import { TransferController } from './controllers/transfer.controller';
import { HolderController } from './controllers/holder.controller';

// Services
import { StockEventService } from './services/stock-event.service';
import { SafetyStockService } from './services/safety-stock.service';
import { LocationService } from './services/location.service';
import { InventoryCommandService } from './services/inventory-command.service';
import { InventoryQueryService } from './services/inventory-query.service';
import { SkuManagersService } from './services/sku-managers.service';
import { SkuLocationMovementService } from './services/sku-location-movement.service';
import { AllocationStrategyService } from './services/allocation-strategy.service';
import { FifoLocationStrategy, LOCATION_RESOLUTION_STRATEGY } from './services/location-resolution.strategy';
import { ReservationCronService } from './services/reservation-cron.service';
import { ReturnService } from './services/return.service';
import { TransferService } from './services/transfer.service';
import { HolderService } from './services/holder.service';

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
    SkuLocationMovementController,
    ReservationController,
    ReturnController,
    TransferController,
    HolderController,
  ],
  providers: [
    StockEventService,
    SafetyStockService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    SkuManagersService,
    SkuLocationMovementService,
    AllocationStrategyService,
    { provide: LOCATION_RESOLUTION_STRATEGY, useClass: FifoLocationStrategy },
    ReservationCronService,
    ReturnService,
    TransferService,
    HolderService,
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
    SkuLocationMovementService,
    AllocationStrategyService,
    LOCATION_RESOLUTION_STRATEGY,
    ReturnService,
    TransferService,
    HolderService,
    OutboxService,
  ],
})
export class CoreInventoryModule {}
