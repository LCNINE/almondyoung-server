import { Module } from '@nestjs/common';
import { StocktakingController } from './controllers/stocktaking.controller';
import { StocktakingService } from './services/stocktaking.service';
import { CoreInventoryModule } from '../core/inventory.module';
import { StockRemovalModule } from '../../fulfillment/stock-removal/stock-removal.module';

@Module({
  imports: [CoreInventoryModule, StockRemovalModule],
  controllers: [StocktakingController],
  providers: [StocktakingService],
  exports: [StocktakingService],
})
export class StocktakingModule {}
