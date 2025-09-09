// apps/notification/src/shared/shared.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';

// Controllers
import { EventController } from './controllers/event.controller';
import { LogController } from './controllers/log.controller';
import { MetricsController } from './controllers/metrics.controller';
import { UserNotificationController } from './controllers/user-notification.controller';
import { WebhookController } from './controllers/webhook.controller';

// Services
import { AlertService } from './services/alert.service';
import { EventMappingService } from './services/event-mapping.service';
import { MetricsService } from './services/metrics.service';
import { NotificationLoggerService } from './services/notification-logger.service';
import { TemplateRendererService } from './services/template-renderer.service';
import { UserNotificationService } from './services/user-notification.service';
import { UserSyncService } from './services/user-sync.service';
import { WebhookService } from './services/webhook.service';

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
        EventController,
        LogController,
        MetricsController,
        UserNotificationController,
        WebhookController,
    ],
    providers: [
        AlertService,
        EventMappingService,
        MetricsService,
        NotificationLoggerService,
        TemplateRendererService,
        UserNotificationService,
        UserSyncService,
        WebhookService,
    ],
    exports: [
        // 다른 모듈에서 필요한 서비스만 export
        AlertService,
        EventMappingService,
        NotificationLoggerService,
        TemplateRendererService,
        UserNotificationService,
        UserSyncService,
        WebhookService,
    ],
})
export class SharedModule { }