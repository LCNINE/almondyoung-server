import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { DbModule } from '@app/db';
import { CronOnceModule } from '@app/cron-once';
import {
  AuthorizationModule,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
  piiMaskingProviders,
} from '@app/authorization';
import { OutboxPiiAccessRecorder } from '@app/authorization/recorders/outbox-pii-access.recorder';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { validateAlmondyoungEnv } from './config/env.validation';
import { mergedSchema } from './platform/database/merged-schema';
import { AppController } from './app.controller';

import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ProductMatchingModule } from './modules/product-matching/product-matching.module';
import { SalesOrderModule } from './modules/sales-order/sales-order.module';
import { FulfillmentModule } from './modules/fulfillment/fulfillment.module';
import { FulfillmentOutboxDispatchGateModule } from './modules/fulfillment/outbox/fulfillment-dispatch-gate.module';
import { WaybillModule } from './modules/fulfillment/waybill/waybill.module';
import { OrderProgressModule } from './modules/fulfillment/order-progress/order-progress.module';
import { CoreEventFailuresModule } from './modules/event-failures/event-failures.module';
import { OrderReconcileModule } from './modules/fulfillment/order-reconcile/order-reconcile.module';
import { LibraryModule } from './modules/library/library.module';
import { CustomerServiceModule } from './modules/customer-service/customer-service.module';
import { ArchiveModule } from './modules/archive/archive.module';
import { DemoModule } from './modules/demo/demo.module';
import { PrintOrderModule } from './modules/print-order/print-order.module';
import { PrintOrderAdminModule } from './modules/print-order/print-order-admin.module';

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
    AuthorizationModule.forAuthOnly(),
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
    CoreEventFailuresModule,
    LibraryModule,
    CustomerServiceModule,
    ArchiveModule,
    PrintOrderModule,
    PrintOrderAdminModule,
    DemoModule.forEnvironment(),
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). JwtAuthGuard 다음에 등록해야
    // request.user 가 채워진 뒤 역할을 본다(APP_GUARD 는 등록 순). 분류 표식이 없는 라우트는 거부한다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 개인정보 표시 제한 — 다른 응답 인터셉터보다 바깥에서 최종 본문을 본다.
    ...piiMaskingProviders({ service: 'core', recorder: OutboxPiiAccessRecorder }),
  ],
})
export class AppModule {}
