// apps/wms/src/inbound/inbound.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from '../inventory/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { InboundService } from './services/inbound.service';
import { PurchaseOrderService } from './services/purchase-order.service';

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
    SharedModule,
  ],
  controllers: [InboundController, PurchaseOrderController],
  providers: [InboundService, PurchaseOrderService],
  exports: [InboundService, PurchaseOrderService],
})
export class InboundModule { }