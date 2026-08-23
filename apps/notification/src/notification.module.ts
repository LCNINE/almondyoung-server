// apps/notification/src/notification.module.ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AdminRealmGuard, AuthorizationModule, JwtAuthGuard } from '@app/authorization';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { EventTraceApiModule } from '@app/events';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { validateNotificationEnv } from './config/env.validation';
import { notificationTables, NotificationSchema } from '../database/schemas/notification-schema';
import { HealthController } from './health.controller';

// Core modules
import { SharedModule } from './shared/shared.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { ProviderModule } from './provider/provider.module';
import { TemplateModule } from './template/template.module';
import { BulkModule } from './bulk/bulk.module';
import { DeviceModule } from './device/device.module';
import { EventTraceController } from './shared/controllers/event-trace.controller';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NOTIFICATION_ENV_PATH,
      validate: validateNotificationEnv,
    }),
    // Redis가 있으면 Bull 큐 사용, 없으면 직접 발송
    ...(process.env.REDIS_HOST
      ? [
          BullModule.forRoot({
            redis: {
              host: process.env.REDIS_HOST,
              port: parseInt(process.env.REDIS_PORT || '6379'),
              password: process.env.REDIS_PASSWORD,
            },
          }),
        ]
      : []),
    DbModule.forRoot<NotificationSchema>({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    // 스코프는 선언하지 않는다 — 이 서비스의 인가는 "직원이냐" 한 축뿐이고, 스코프를 선언하면
    // 부팅 시 `auth.scopes` 를 읽는데 notification DB 에는 그 스키마가 없다.
    AuthorizationModule.forRoot({ microserviceName: 'notification', scopes: [] }),
    EventTraceApiModule,
    SharedModule,
    DispatcherModule,
    ProviderModule,
    TemplateModule,
    BulkModule,
    DeviceModule,
  ],
  controllers: [HealthController, EventTraceController],
  providers: [
    // 이 서비스는 알림 템플릿/프로바이더 CRUD 와 실제 발송 테스트를 노출하는데, 공용 ALB 의
    // 와일드카드 도메인으로 인터넷에서 도달한다. 그동안 인증이 전혀 없었다.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: AdminRealmGuard },
  ],
})
export class NotificationModule {}
