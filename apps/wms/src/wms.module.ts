import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { SkuModule } from './sku/sku.module';
import { OrderCollectModule } from './order-collect/order-collect.module';
import { StockModule } from './stock/stock.module';
import { ProductMatchingModule } from './product-matching/product-matching.module';

@Module({
  imports: [SkuModule, OrderCollectModule, StockModule, ProductMatchingModule],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule { }
