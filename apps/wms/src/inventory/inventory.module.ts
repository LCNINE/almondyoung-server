import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from '../shared/shared.module';
import { EventsModule } from '@app/events';
import { PRODUCT_STREAM } from '@packages/event-contracts';
import { InventoryController } from './controllers/inventory.controller';
import { ProductMatchingController } from './controllers/product-matching.controller';
import { LocationController } from './controllers/location.controller';
import { InventoryService } from './services/inventory.service';
import { ProductMatchingService } from './services/product-matching.service';
import { StockEventService } from './services/stock-event.service';
import { SafetyStockService } from './services/safety-stock.service';
import { LocationService } from './services/location.service';
import { StockEventStore } from './repositories/stock-event.store';
import { InventoryCommandService } from './services/inventory-command.service';
import { InventoryQueryService } from './services/inventory-query.service';
import { ProductEventConsumer } from './handlers/product-event.consumer';
import { VariantMatchingStrategy } from './strategies/variant-matching.strategy';
import { VoidMatchingStrategy } from './strategies/void-matching.strategy';
import { MasterService } from './services/master.service';
import { MastersController } from './controllers/masters.controller';
// Phase 2 Step 6: New services and controllers
import { SkuPricingService } from './services/sku-pricing.service';
import { SkuManagersService } from './services/sku-managers.service';
import { SkuLocationMovementService } from './services/sku-location-movement.service';
import { SkuPricingController } from './controllers/sku-pricing.controller';
import { SkuManagersController, ManagerSkusController } from './controllers/sku-managers.controller';
import {
  SkuLocationMovementController,
  SkuMovementHistoryController,
  LocationMovementHistoryController,
} from './controllers/sku-location-movement.controller';
// Phase 1 Step 1: Reservation & Allocation
import { AllocationStrategyService } from './services/allocation-strategy.service';
import { ReservationCronService } from './services/reservation-cron.service';
import { ReservationController } from './controllers/reservation.controller';
// Phase 1 Step 1.2: Returns Processing
import { ReturnService } from './services/return.service';
import { ReturnController } from './controllers/return.controller';
// Phase 1 Step 1.3: Transfer Automation
import { TransferService } from './services/transfer.service';
import { TransferController } from './controllers/transfer.controller';
// Phase 3 Week 7: SKU Groups Management
import { SkuGroupService } from './services/sku-group.service';
import { SkuGroupController } from './controllers/sku-group.controller';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsTables,
    }),
    SharedModule,
    EventsModule.forConsumerModule({
      streams: [PRODUCT_STREAM],
      groupId: 'wms-product-consumer',
      enableAutoDLQ: true,
    }),
  ],
  controllers: [
    InventoryController,
    ProductMatchingController,
    LocationController,
    MastersController,
    // Phase 2 Step 6: New controllers
    SkuPricingController,
    SkuManagersController,
    ManagerSkusController,
    SkuLocationMovementController,
    SkuMovementHistoryController,
    LocationMovementHistoryController,
    // Phase 1 Step 1: Reservation controller
    ReservationController,
    // Phase 1 Step 1.2: Returns controller
    ReturnController,
    // Phase 1 Step 1.3: Transfer controller
    TransferController,
    // Phase 3 Week 7: SKU Groups controller
    SkuGroupController,
    // Phase 3: Product Event Consumer (Kafka)
    ProductEventConsumer,
  ],
  providers: [
    InventoryService,
    ProductMatchingService,
    StockEventService,
    SafetyStockService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    VariantMatchingStrategy,
    VoidMatchingStrategy,
    MasterService,
    // Phase 2 Step 6: New services
    SkuPricingService,
    SkuManagersService,
    SkuLocationMovementService,
    // Phase 1 Step 1: Reservation & Allocation services
    AllocationStrategyService,
    ReservationCronService,
    // Phase 1 Step 1.2: Returns service
    ReturnService,
    // Phase 1 Step 1.3: Transfer service
    TransferService,
    // Phase 3 Week 7: SKU Groups service
    SkuGroupService,
  ],
  exports: [
    InventoryService,
    ProductMatchingService,
    StockEventService,
    SafetyStockService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    MasterService,
    // Phase 2 Step 6: Export new services
    SkuPricingService,
    SkuManagersService,
    SkuLocationMovementService,
    // Phase 1 Step 1: Export reservation services
    AllocationStrategyService,
    // Phase 1 Step 1.2: Export returns service
    ReturnService,
    // Phase 1 Step 1.3: Export transfer service
    TransferService,
    // Phase 3 Week 7: Export SKU Groups service
    SkuGroupService,
  ],
})
export class InventoryModule { }