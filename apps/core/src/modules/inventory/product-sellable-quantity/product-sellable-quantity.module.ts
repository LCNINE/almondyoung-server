import { Module } from '@nestjs/common';
import { ProductSellableQuantityController } from './controllers/product-sellable-quantity.controller';
import { ProductSellableQuantityService } from './services/product-sellable-quantity.service';

@Module({
  controllers: [ProductSellableQuantityController],
  providers: [ProductSellableQuantityService],
  exports: [ProductSellableQuantityService],
})
export class ProductSellableQuantityModule {}
