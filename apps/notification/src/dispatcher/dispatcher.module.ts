// apps/notification/src/dispatcher/dispatcher.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { NotificationController } from './controllers/notification.controller';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationProcessor } from './processors/notification.processor';
import { ProviderModule } from '../provider/provider.module';
import { TemplateModule } from '../template/template.module';
import { SharedModule } from '../shared/shared.module';

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
        forwardRef(() => TemplateModule),
        SharedModule,
    ],
    controllers: [NotificationController],
    providers: [
        NotificationDispatcherService,
        NotificationProcessor,
    ],
    exports: [NotificationDispatcherService],
})
export class DispatcherModule { }