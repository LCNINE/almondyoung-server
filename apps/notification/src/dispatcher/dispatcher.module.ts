// apps/notification/src/dispatcher/dispatcher.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { NotificationController } from './controllers/notification.controller';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationProcessor } from './processors/notification.processor';
import { ProviderModule } from '../provider/provider.module';
import { TemplateModule } from '../template/template.module';
import { UserNotificationService } from '../shared/services/user-notification.service';
import { TemplateRendererService } from '../shared/services/template-renderer.service';
import { NotificationLoggerService } from '../shared/services/notification-logger.service';
import { AlertService } from '../shared/services/alert.service';

@Module({
    imports: [
        BullModule.registerQueue(
            { name: 'notification' },
            { name: 'notification-retry' },
            { name: 'notification-scheduled' }
        ),
        DbModule.forRoot({
            config: {
                connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
            },
            schema: notificationTables,
        }),
        ProviderModule,
        TemplateModule,
    ],
    controllers: [NotificationController, UserNotificationController],
    providers: [
        NotificationDispatcherService,
        NotificationProcessor,
        UserNotificationService,
        TemplateRendererService,
        NotificationLoggerService,
        AlertService,
    ],
    exports: [NotificationDispatcherService],
})
export class DispatcherModule { }