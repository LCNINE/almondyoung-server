import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { InventoryModule } from './inventory/inventory.module';
import { OrderModule } from './order/order.module';
import { MovementModule } from './movement/movement.module';
import { InboundModule } from './inbound/inbound.module';
import { SharedModule } from './shared/shared.module';
import { DbModule } from '@app/db';
import { wmsSchema } from '../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsSchema,
    }),
    InventoryModule,
    MovementModule,
    InboundModule,
    SharedModule,
    OrderModule,
  ],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule { }