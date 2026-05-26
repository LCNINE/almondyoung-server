import { Module } from '@nestjs/common';
import { OutboxService } from '../shared/outbox/outbox.service';
import { ProductSellableQuantityController } from './controllers/product-sellable-quantity.controller';
import { ProductSellableQuantityService } from './services/product-sellable-quantity.service';

@Module({
  controllers: [ProductSellableQuantityController],
  providers: [ProductSellableQuantityService, OutboxService],
  exports: [ProductSellableQuantityService],
})
export class ProductSellableQuantityModule {}
