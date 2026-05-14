import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { CoreInventoryModule } from '../core/inventory.module';
import { StockProjectionController } from './controllers/stock-projection.controller';
import { StockProjectionService } from './services/stock-projection.service';
import { StockProjectionReader } from './services/stock-projection.reader';
import { StockProjectionManager } from './services/stock-projection.manager';

@Module({
  imports: [SharedModule, CoreInventoryModule],
  controllers: [StockProjectionController],
  providers: [StockProjectionService, StockProjectionReader, StockProjectionManager],
  exports: [StockProjectionService],
})
export class StockProjectionModule {}
