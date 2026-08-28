import { Module } from '@nestjs/common';
import { StockValuationController } from './controllers/stock-valuation.controller';
import { StockValuationService } from './services/stock-valuation.service';
import { StockValuationReader } from './services/stock-valuation.reader';

@Module({
  controllers: [StockValuationController],
  providers: [StockValuationService, StockValuationReader],
})
export class StockValuationModule {}
