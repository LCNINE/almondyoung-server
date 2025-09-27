// apps/notification/src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { HttpModule } from '@nestjs/axios';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { NotificationLoggerService } from './services/notification-logger.service';
import { AlertService } from './services/alert.service';
import { WebhookService } from './services/webhook.service';

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
  ],
  exports: [
    NotificationLoggerService,
    AlertService,
    WebhookService,
  ],
})
export class SharedModule {}
