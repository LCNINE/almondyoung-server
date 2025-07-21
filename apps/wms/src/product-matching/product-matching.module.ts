// apps/wms/src/product-matching/product-matching.module.ts
import { Module } from '@nestjs/common';
import { ProductMatchingService } from './product-matching.service';
import { ProductMatchingController } from './product-matching.controller';
import { PimEventHandler } from './pim-event.handler';
import { SkuModule } from '../sku/sku.module';
import { StockModule } from '../stock/stock.module';
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
    StockModule,
    WarehouseModule
  ],
  controllers: [ProductMatchingController],
  providers: [ProductMatchingService, PimEventHandler],
  exports: [ProductMatchingService],
})
export class ProductMatchingModule { }