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
import { SkuManagersService } from './services/sku-managers.service';
import { SkuLocationMovementService } from './services/sku-location-movement.service';
import { SkuManagersController, ManagerSkusController } from './controllers/sku-managers.controller';
import {
  SkuLocationMovementController,
  // SkuMovementHistoryController,
  // LocationMovementHistoryController,
} from './controllers/sku-location-movement.controller';
import { AllocationStrategyService } from './services/allocation-strategy.service';
import { ReservationCronService } from './services/reservation-cron.service';
import { ReservationController } from './controllers/reservation.controller';
import { ReturnService } from './services/return.service';
import { ReturnController } from './controllers/return.controller';
import { TransferService } from './services/transfer.service';
import { TransferController } from './controllers/transfer.controller';
import { SkuGroupService } from './services/sku-group.service';
import { SkuGroupController } from './controllers/sku-group.controller';
import { HolderService } from './services/holder.service';
import { HolderController } from './controllers/holder.controller';

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
    SkuManagersController,
    ManagerSkusController,
    SkuLocationMovementController,
    // SkuMovementHistoryController,
    // LocationMovementHistoryController,
    ReservationController,
    ReturnController,
    TransferController,
    SkuGroupController,
    HolderController,
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
    SkuManagersService,
    SkuLocationMovementService,
    AllocationStrategyService,
    ReservationCronService,
    ReturnService,
    TransferService,
    SkuGroupService,
    HolderService,
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
    SkuManagersService,
    SkuLocationMovementService,
    AllocationStrategyService,
    ReturnService,
    TransferService,
    SkuGroupService,
    HolderService,
  ],
})
export class InventoryModule { }