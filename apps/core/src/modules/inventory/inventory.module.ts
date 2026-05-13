import { Module } from '@nestjs/common';
import { EventsModule } from '@app/events';
import { INVENTORY_STREAM } from '@packages/event-contracts';
import { CoreInventoryModule } from './core/inventory.module';
import { InboundModule } from './inbound/inbound.module';
import { MovementModule } from './movement/movement.module';
import { StocktakingModule } from './stocktaking/stocktaking.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SharedModule } from './shared/shared.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { SkuGroupModule } from './sku-group/sku-group.module';

@Module({
  imports: [
    EventsModule.forRoot({
      streams: [INVENTORY_STREAM],
      serviceName: 'almondyoung',
      enableDLQ: true,
    }),
    SharedModule,
    CoreInventoryModule,
    WarehouseModule,
    SkuGroupModule,
    InboundModule,
    MovementModule,
    StocktakingModule,
    SuppliersModule,
  ],
  exports: [
    CoreInventoryModule,
    WarehouseModule,
    SkuGroupModule,
    SharedModule,
  ],
})
export class InventoryModule {}
