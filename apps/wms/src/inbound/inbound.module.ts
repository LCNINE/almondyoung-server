import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { wmsTables, wmsSchema } from '../../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { InventoryModule } from '../inventory/inventory.module';
import { SharedModule } from '../shared/shared.module';
import { InboundController } from './controllers/inbound.controllers';
import { PurchaseOrderController } from './controllers/purchase-order.controller';
import { InboundListController } from './controllers/inbound-list.controller';
import { InboundService } from './services/inbound.service';
import { PurchaseOrderService } from './services/purchase-order.service';
import { InboundListService } from './services/inbound-list.service';

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
  controllers: [InboundController, PurchaseOrderController, InboundListController],
  providers: [InboundService, PurchaseOrderService, InboundListService],
  exports: [InboundService, PurchaseOrderService, InboundListService],
})
export class InboundModule { }