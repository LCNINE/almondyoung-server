import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { ExampleModule } from './example/example.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrderCollectModule } from './order-collect/order-collect.module';

@Module({
  imports: [ExampleModule, InventoryModule, OrderCollectModule],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule {}
