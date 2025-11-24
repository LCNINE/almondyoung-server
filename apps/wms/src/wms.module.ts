import { Module } from '@nestjs/common';
import { WmsController } from './wms.controller';
import { WmsService } from './wms.service';
import { InventoryModule } from './inventory/inventory.module';
import { OrderModule } from './order/order.module';
import { MovementModule } from './movement/movement.module';
import { InboundModule } from './inbound/inbound.module';
import { SharedModule } from './shared/shared.module';
import { StocktakingModule } from './stocktaking/stocktaking.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { DbModule } from '@app/db';
import { wmsSchema } from '../database/schemas/wms-schema';
import { ConfigModule } from '@nestjs/config';
import { validateWmsEnv } from './config/env.validation';
import { AuthorizationModule, JwtAuthGuard } from '@app/authorization';
import { APP_GUARD } from '@nestjs/core';
import { WMS_SCOPES } from './auth/wms.scopes';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateWmsEnv,
      envFilePath: ['.env', 'apps/wms/.env'],
    }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: wmsSchema,
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'wms',
      scopes: WMS_SCOPES,
    }),
    InventoryModule,
    MovementModule,
    InboundModule,
    SharedModule,
    OrderModule,
    StocktakingModule,
    SuppliersModule,
  ],
  controllers: [WmsController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }, WmsService],
})
export class WmsModule {}
