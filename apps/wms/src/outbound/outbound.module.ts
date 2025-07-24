import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from '../inventory/inventory.module';
import { ReservationModule } from '../reservation/reservation.module';
import { SharedModule } from '../shared/shared.module';
import { OutboundController } from './controllers/outbound.controller';
import { PickingController } from './controllers/picking.controller';
import { OutboundService } from './services/outbound.service';
import { PickingService } from './services/picking.service';
import { PackingService } from './services/packing.service';

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
    SharedModule,
  ],
  controllers: [OutboundController, PickingController],
  providers: [OutboundService, PickingService, PackingService],
  exports: [OutboundService, PickingService, PackingService],
})
export class OutboundModule { }
