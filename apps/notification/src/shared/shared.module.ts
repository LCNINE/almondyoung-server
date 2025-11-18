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

@Module({
  imports: [

    HttpModule,
    ConfigModule,
    DbModule,
    EventsModule,
  ],
  providers: [
    NotificationLoggerService,
    AlertService,
    WebhookService,
    EventMappingService,
  ],
  exports: [
    NotificationLoggerService,
    AlertService,
    WebhookService,
    EventMappingService,
  ],
})
export class SharedModule {}
