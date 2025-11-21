// apps/notification/src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HttpModule } from '@nestjs/axios';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
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
    DbModule,
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
