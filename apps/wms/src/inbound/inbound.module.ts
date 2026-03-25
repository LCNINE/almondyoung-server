import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { InventoryModule } from '../inventory/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { InboundService } from './services/inbound.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { PurchaseOrderCronService } from './services/purchase-order-cron.service';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ScheduleModule.forRoot(),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsTables,
    }),
    InventoryModule,
    SharedModule,
  ],
  controllers: [InboundController, PurchaseOrderController],
  providers: [InboundService, PurchaseOrderService, PurchaseOrderCronService],
  exports: [InboundService, PurchaseOrderService],
})
export class InboundModule {}
