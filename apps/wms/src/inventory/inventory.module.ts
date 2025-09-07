import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
import { InventoryController } from './controllers/inventory.controller';
import { ProductMatchingController } from './controllers/product-matching.controller';
import { LocationController } from './controllers/location.controller';
import { InventoryService } from './services/inventory.service';
import { ProductMatchingService } from './services/product-matching.service';
import { StockEventService } from './services/stock-event.service';
import { LocationService } from './services/location.service';
import { StockEventStore } from './repositories/stock-event.store';
import { InventoryCommandService } from './services/inventory-command.service';
import { InventoryQueryService } from './services/inventory-query.service';
import { PimEventHandler } from './handlers/pim-event.hadler';
import { VariantMatchingStrategy } from './strategies/variant-matching.strategy';
import { OptionMatchingStrategy } from './strategies/option-matching.strategy';
import { VoidMatchingStrategy } from './strategies/void-matching.strategy';
import { OptionEngineModule } from '@app/shared';
import { MasterService } from './services/master.service';
import { MastersController } from './controllers/masters.controller';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsTables,
    }),
    SharedModule,
    OptionEngineModule,
  ],
  controllers: [
    InventoryController,
    ProductMatchingController,
    LocationController,
    MastersController
  ],
  providers: [
    InventoryService,
    ProductMatchingService,
    StockEventService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    PimEventHandler,
    VariantMatchingStrategy,
    OptionMatchingStrategy,
    VoidMatchingStrategy,
    MasterService,
  ],
  exports: [
    InventoryService,
    ProductMatchingService,
    StockEventService,
    LocationService,
    StockEventStore,
    InventoryCommandService,
    InventoryQueryService,
    MasterService,
  ],
})
export class InventoryModule { }