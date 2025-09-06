import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { SharedModule } from '../shared/shared.module';
// Controllers
import { ShipmentController } from './controllers/shipment.controller';
// Services
import { ShipmentService } from './services/shipment.service';
import { CarrierService } from './services/carrier.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsTables,
    }),
    SharedModule,
  ],
  controllers: [/* ShipmentController */],
  providers: [ShipmentService, CarrierService],
  exports: [ShipmentService, CarrierService],
})
export class ShipmentModule { }