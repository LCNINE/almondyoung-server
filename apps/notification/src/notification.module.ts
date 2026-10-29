// apps/notification/src/notification.module.ts
import { Module } from '@nestjs/common';
import { WebPushModule } from './web-push/web-push.module';
import { APP_GUARD } from '@nestjs/core';
import {
  AuthorizationModule,
  JwtAuthGuard,
  PermissionGuard,
  PermissionModule,
  piiMaskingProviders,
} from '@app/authorization';
import { HttpPiiAccessRecorder } from './shared/pii/http-pii-access.recorder';
import { LoggerModule } from 'nestjs-pino';
import { loggerConfig } from '@app/shared/observability/logger.config';
import { EventTraceApiModule } from '@app/events';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';
import { DbModule } from '@app/db';
import { CronOnceModule } from '@app/cron-once';
import { validateNotificationEnv } from './config/env.validation';
import { notificationTables, NotificationSchema } from '../database/schemas/notification-schema';
import { DemoNotificationController } from './demo/demo-notification.controller';
import { HealthController } from './health.controller';

// Core modules
import { SharedModule } from './shared/shared.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { ProviderModule } from './provider/provider.module';
import { TemplateModule } from './template/template.module';
import { BulkModule } from './bulk/bulk.module';
import { DeviceModule } from './device/device.module';
import { SmsGateModule } from './sms-gate/sms-gate.module';
import { AlimtalkModule } from './alimtalk/alimtalk.module';
import { EventTraceController } from './shared/controllers/event-trace.controller';
import { TenancyModule } from '@app/tenancy';

@Module({
  imports: [
    LoggerModule.forRoot(loggerConfig),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.NOTIFICATION_ENV_PATH,
      validate: validateNotificationEnv,
    }),
    // 테넌트 목록·전환 모드. 틀리면 여기서 기동 거부 (@app/tenancy).
    TenancyModule,
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
    AuthorizationModule.forAuthOnly(),
    PermissionModule.forRoot({ service: 'notification' }),
    EventTraceApiModule,
    SharedModule,
    DispatcherModule,
    ProviderModule,
    TemplateModule,
    // Demo delivers immediately through the mock provider and has no Redis resource.
    ...(process.env.APP_STAGE === 'demo' ? [] : [BulkModule]),
    DeviceModule,
    WebPushModule,
    SCHEDULE_ROOT,
    CronOnceModule,
    SmsGateModule,
    AlimtalkModule,
  ],
  controllers: [
    HealthController,
    EventTraceController,
    ...(process.env.APP_STAGE === 'demo' ? [DemoNotificationController] : []),
  ],
  providers: [
    // 이 서비스는 알림 템플릿/프로바이더 CRUD 와 실제 발송 테스트를 노출하는데, 공용 ALB 의
    // 와일드카드 도메인으로 인터넷에서 도달한다. 그동안 인증이 전혀 없었다.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // 권한 판정 — 라우트 인가를 결정한다(설정으로 끌 수 없다). 인증 가드 뒤에 둔다.
    { provide: APP_GUARD, useClass: PermissionGuard },
    // 개인정보 표시 제한 — 다른 응답 인터셉터보다 바깥에서 최종 본문을 본다.
    ...piiMaskingProviders({ service: 'notification', recorder: HttpPiiAccessRecorder }),
  ],
})
export class NotificationModule {}
