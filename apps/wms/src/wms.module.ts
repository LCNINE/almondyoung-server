import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { InventoryModule } from './inventory/inventory.module';
import { ReservationModule } from './reservation/reservation.module';
import { OutboundModule } from './outbound/outbound.module';
import { MovementModule } from './movement/movement.module';
import { ShipmentModule } from './shipment/shipment.module';
import { InboundModule } from './inbound/inbound.module';
import { ReturnModule } from './return/return.module';
import { SharedModule } from './shared/shared.module';
import { DbModule } from '@app/db';
import { wmsTables } from '../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsTables,
    }),
    InventoryModule,
    ReservationModule,
    OutboundModule,
    MovementModule,
    ShipmentModule,
    InboundModule,
    ReturnModule,
    SharedModule,
  ],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule { }