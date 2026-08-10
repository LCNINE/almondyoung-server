import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from '@app/db';
import { AdminRealmGuard, AuthorizationModule, JwtAuthGuard } from '@app/authorization';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { validateAlmondyoungEnv } from './config/env.validation';
import { mergedSchema } from './platform/database/merged-schema';
import { ALL_ROLE_MAPPINGS, ALL_SCOPES } from './platform/auth/merged-scopes';
import { AppController } from './app.controller';

import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductMatchingModule } from './modules/product-matching/product-matching.module';
import { SalesOrderModule } from './modules/sales-order/sales-order.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { FulfillmentOutboxDispatchGateModule } from './modules/fulfillment/outbox/fulfillment-dispatch-gate.module';
import { WaybillModule } from './modules/fulfillment/waybill/waybill.module';
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
      roleMappings: ALL_ROLE_MAPPINGS,
    }),
    // EventsModule.forApp 은 각 BC 모듈 내부에서 등록 (Catalog: PRODUCT_STREAM)

    CatalogModule,
    InventoryModule,
    ProductMatchingModule,
    SalesOrderModule,
    FulfillmentOutboxDispatchGateModule,
    FulfillmentModule,
    WaybillModule,
    LibraryModule,
    CustomerServiceModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // JwtAuthGuard 다음에 등록해야 request.user 가 채워진 뒤 역할을 본다 (APP_GUARD 는 등록 순).
    // 표시가 없는 라우트를 직원 전용으로 막는다 — @Public/@OptionalAuth/@StoreRoute/@RequireScopes
    // 중 하나가 붙은 라우트는 각자의 정책에 위임한다. 상세는 AdminRealmGuard 주석 참조.
    { provide: APP_GUARD, useClass: AdminRealmGuard },
  ],
})
export class AppModule {}
