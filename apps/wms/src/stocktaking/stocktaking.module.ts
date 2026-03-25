import { Module } from '@nestjs/common';
import { StocktakingController } from './controllers/stocktaking.controller';
import { StocktakingService } from './services/stocktaking.service';

@Module({
  controllers: [StocktakingController],
  providers: [StocktakingService],
  exports: [StocktakingService],
})
export class StocktakingModule {}
