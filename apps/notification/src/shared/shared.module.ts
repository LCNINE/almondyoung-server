// apps/notification/src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HttpModule } from '@nestjs/axios';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { notificationTables } from '../../database/schemas/notification-schema';
import { NotificationLoggerService } from './services/notification-logger.service';
import { AlertService } from './services/alert.service';
import { WebhookService } from './services/webhook.service';
import { EventMappingService } from './services/event-mapping.service';
import { MetricsService } from './services/metrics.service';
import { MetadataController } from './controllers/metadata.controller';
import { LogController } from './controllers/log.controller';
import { MetricsController } from './controllers/metrics.controller';

@Module({
  imports: [
    HttpModule,
    ConfigModule,
    // NotificationModule에서 이미 forRoot로 설정되어 있지만,
    // 일관성과 안전성을 위해 명시적으로 설정
    // (DbModule이 GlobalModule이 아닌 경우를 대비)
    DbModule.forRoot({
      config: {
        connectionString: process.env.DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    EventsModule,
  ],
  controllers: [MetadataController, LogController, MetricsController],
  providers: [
    NotificationLoggerService,
    AlertService,
    WebhookService,
    EventMappingService,
    MetricsService,
  ],
  exports: [
    NotificationLoggerService,
    AlertService,
    WebhookService,
    EventMappingService,
    MetricsService,
  ],
})
export class SharedModule { }
