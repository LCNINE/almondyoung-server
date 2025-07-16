// apps/wms/src/wms.module.ts
import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { WarehouseModule } from './warehouse/warehouse.module';
import { SkuModule } from './sku/sku.module';
import { OrderCollectModule } from './order-collect/order-collect.module';
import { StockModule } from './stock/stock.module';
import { ProductMatchingModule } from './product-matching/product-matching.module';
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
    WarehouseModule,
    SkuModule,
    OrderCollectModule,
    StockModule,
    ProductMatchingModule
  ],
  controllers: [WmsController],
  providers: [WmsService],
})
export class WmsModule { }
