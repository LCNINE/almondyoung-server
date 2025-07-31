// apps/notification/src/shared/shared.module.ts
import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';

import { UserNotificationService } from './services/user-notification.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { WebhookService } from './services/webhook.service';
import { EventMappingService } from './services/event-mapping.service';
import { NotificationLoggerService } from './services/notification-logger.service';
import { AlertService } from './services/alert.service';
import { UserSyncService } from './services/user-sync.service';
import { UserNotificationController } from './controllers/user-notification.controller';
import { WebhookController } from './controllers/webhook.controller';
import { EventController } from './controllers/event.controller';
import { LogController } from './controllers/log.controller';


@Global()
@Module({
    imports: [
        ConfigModule,
        DbModule.forRoot({
            config: {
                connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
            },
            schema: notificationTables,
        }),
    ],
    controllers: [
        UserNotificationController,
        EventController,
        WebhookController,
        LogController,
    ],
    providers: [
        UserNotificationService,
        TemplateRendererService,
        EventMappingService,
        WebhookService,
        NotificationLoggerService,
        AlertService,
        UserSyncService,
    ],
    exports: [
        UserNotificationService,
        TemplateRendererService,
        EventMappingService,
        WebhookService,
        NotificationLoggerService,
        AlertService,
        UserSyncService,
    ],
})
export class SharedModule { }