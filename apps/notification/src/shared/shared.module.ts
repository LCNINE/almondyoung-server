// apps/notification/src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { EventMappingService } from './services/event-mapping.service';
import { NotificationLoggerService } from './services/notification-logger.service';
import { AlertService } from './services/alert.service';
import { UserIntegrationService } from './services/user-integration.service';
import { WebhookService } from './services/webhook.service';

@Module({
  imports: [
    ConfigModule,
    DbModule,
    EventsModule,
  ],
  providers: [
    EventMappingService,
    NotificationLoggerService,
    AlertService,
    UserIntegrationService,
    WebhookService,
  ],
  exports: [
    EventMappingService,
    NotificationLoggerService,
    AlertService,
    UserIntegrationService,
    WebhookService,
  ],
})
export class SharedModule {}
