import { Module } from '@nestjs/common';
import { StocktakingController } from './controllers/stocktaking.controller';
import { StocktakingService } from './services/stocktaking.service';
import { CoreInventoryModule } from '../core/inventory.module';

@Module({
  imports: [CoreInventoryModule],
  controllers: [StocktakingController],
  providers: [StocktakingService],
  exports: [StocktakingService],
})
export class StocktakingModule {}
