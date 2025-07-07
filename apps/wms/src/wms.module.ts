import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { SkuModule } from './sku/sku.module';
import { OrderCollectModule } from './order-collect/order-collect.module';

@Module({
  imports: [SkuModule, OrderCollectModule],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule { }
