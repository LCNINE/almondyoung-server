import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
import { InventoryController } from './controllers/inventory.controller';
import { ProductMatchingController } from './controllers/product-matching.controller';
import { InventoryService } from './services/inventory.service';
import { ProductMatchingService } from './services/product-matching.service';
import { StockEventService } from './services/stock-event.service';
import { LocationService } from './services/location.service';
import { StockEventStore } from './repositories/stock-event.store';
import { StockSummaryRepository } from './repositories/ stock-summary.repository';
import { PimEventHandler } from './handlers/pim-event.hadler';
import { VariantMatchingStrategy } from './strategies/variant-matching.strategy';
import { OptionMatchingStrategy } from './strategies/option-matching.strategy';
import { VoidMatchingStrategy } from './strategies/void-matching.strategy';

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
  ],
  controllers: [
    InventoryController,
    ProductMatchingController
  ],
  providers: [
    InventoryService,
    ProductMatchingService,
    StockEventService,
    LocationService,
    StockEventStore,
    StockSummaryRepository,
    PimEventHandler,
    VariantMatchingStrategy,
    OptionMatchingStrategy,
    VoidMatchingStrategy,
  ],
  exports: [
    InventoryService,
    ProductMatchingService,
    StockEventService,
    LocationService,
    StockEventStore,
    StockSummaryRepository,
  ],
})
export class InventoryModule { }