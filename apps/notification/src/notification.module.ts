// apps/notification/src/notification.module.ts
import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
    EventTraceApiModule,
    SharedModule,
    DispatcherModule,
    ProviderModule,
    TemplateModule,
    BulkModule,
    DeviceModule,
  ],
  controllers: [HealthController],
})
export class NotificationModule {}
