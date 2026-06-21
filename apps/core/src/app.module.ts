import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from '@app/db';
import { AuthorizationModule, JwtAuthGuard } from '@app/authorization';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { validateAlmondyoungEnv } from './config/env.validation';
import { mergedSchema } from './platform/database/merged-schema';
import { ALL_SCOPES } from './platform/auth/merged-scopes';
import { AppController } from './app.controller';

import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductMatchingModule } from './modules/product-matching/product-matching.module';
import { SalesOrderModule } from './modules/sales-order/sales-order.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { LibraryModule } from './modules/library/library.module';
import { CustomerServiceModule } from './modules/customer-service/customer-service.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateAlmondyoungEnv,
      envFilePath: ['.env', 'apps/core/.env'],
    }),
    LoggerModule.forRoot(loggerConfig),
    DbModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connectionString: configService.get<string>('DATABASE_URL') ?? '',
      }),
      schema: mergedSchema,
    }),
    AuthorizationModule.forRoot({
      microserviceName: 'almondyoung',
      scopes: ALL_SCOPES,
    }),
    // EventsModule.forRoot은 각 BC 모듈 내부에서 등록 (Catalog: PRODUCT_STREAM)

    CatalogModule,
    InventoryModule,
    ProductMatchingModule,
    SalesOrderModule,
    FulfillmentModule,
    LibraryModule,
    CustomerServiceModule,
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
