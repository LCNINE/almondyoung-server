import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from '@app/db';
import { CronOnceModule } from '@app/cron-once';
import {
  AdminRealmGuard,
  AuthorizationModule,
  AuthzObserverGuard,
  AuthzShadowInterceptor,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
} from '@app/authorization';
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
import { OrderProgressModule } from './modules/fulfillment/order-progress/order-progress.module';
import { OrderReconcileModule } from './modules/fulfillment/order-reconcile/order-reconcile.module';
import { LibraryModule } from './modules/library/library.module';
import { CustomerServiceModule } from './modules/customer-service/customer-service.module';
import { ArchiveModule } from './modules/archive/archive.module';
import { DemoModule } from './modules/demo/demo.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateAlmondyoungEnv,
      envFilePath: ['.env', 'apps/core/.env'],
    }),
    LoggerModule.forRoot(loggerConfig),
    // 크론 «주기당 한 번» 선점 (ADR-0036). SCHEDULE_ROOT 는 inventory.module 등이 이미 import 한다.
    CronOnceModule,
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
    PermissionModule.forRoot({ service: 'core' }),
    // EventsModule.forApp 은 각 BC 모듈 내부에서 등록 (Catalog: PRODUCT_STREAM)

    CatalogModule,
    InventoryModule,
    ProductMatchingModule,
    SalesOrderModule,
    FulfillmentOutboxDispatchGateModule,
    FulfillmentModule,
    WaybillModule,
    OrderProgressModule,
    OrderReconcileModule,
    LibraryModule,
    CustomerServiceModule,
    ArchiveModule,
    DemoModule.forEnvironment(),
  ],
  controllers: [AppController],
  providers: [
    // 그림자 판정 관찰 — 반드시 맨 앞(뒤 가드가 거부한 요청도 봐야 한다). 결과에 관여하지 않는다.
    { provide: APP_GUARD, useClass: AuthzObserverGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // JwtAuthGuard 다음에 등록해야 request.user 가 채워진 뒤 역할을 본다 (APP_GUARD 는 등록 순).
    // 표시가 없는 라우트를 직원 전용으로 막는다 — @Public/@OptionalAuth/@StoreRoute/@RequireScopes
    // 중 하나가 붙은 라우트는 각자의 정책에 위임한다. 상세는 AdminRealmGuard 주석 참조.
    { provide: APP_GUARD, useClass: AdminRealmGuard },
    // 권한 강제 — AUTHZ_ENFORCE=true 일 때만 일한다(기본 꺼짐). 기존 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: AuthzShadowInterceptor },
  ],
})
export class AppModule {}
