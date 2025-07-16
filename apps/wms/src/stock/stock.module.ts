// apps/wms/src/stock/stock.module.ts
import { Module } from '@nestjs/common';
import { StockService } from './stock.service';
import { StockController } from './stock.controller';
import { WarehouseTransferService } from './warehouse-transfer.service';
import { SkuModule } from '../sku/sku.module';
import { WarehouseModule } from '../warehouse/warehouse.module';
import { DbModule } from '@app/db';
import { wmsTables } from '../../database/schemas/wms-schema';
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
    SkuModule,
    WarehouseModule
  ],
  controllers: [StockController],
  providers: [StockService, WarehouseTransferService],
  exports: [StockService, WarehouseTransferService],
})
export class StockModule { }
