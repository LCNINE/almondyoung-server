import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { validateNotificationEnv } from './config/env.validation';
import { notificationTables, NotificationSchema } from '../database/schemas/notification-schema';

// Core modules
import { SharedModule } from './shared/shared.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { ProviderModule } from './provider/provider.module';
import { TemplateModule } from './template/template.module';
import { BulkModule } from './bulk/bulk.module';
import { EventHandlersModule } from './event-handlers/event-handlers.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateNotificationEnv,
    }),
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    DbModule.forRoot<NotificationSchema>({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    EventsModule,
    SharedModule,
    DispatcherModule,
    ProviderModule,
    TemplateModule,
    BulkModule,
    EventHandlersModule,
  ],
})
export class NotificationModule {}
