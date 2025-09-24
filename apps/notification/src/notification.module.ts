// apps/notification/src/notification.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { notificationTables } from '../database/schemas/notification-schema';
import { USER_EVENTS, UserEvents } from '@app/shared/events/user.events';

import { TemplateModule } from './template/template.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { ProviderModule } from './provider/provider.module';
import { BulkModule } from './bulk/bulk.module';
import { SharedModule } from './shared/shared.module';
import { EventHandlersModule } from './event-handlers/event-handlers.module';

@Module({
    imports: [
        ConfigModule.forRoot(),
        DbModule.forRoot({
            config: {
                connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
            },
            schema: notificationTables,
        }),
        EventsModule.forRoot<UserEvents>({
            kafka: {
                clientId: process.env.KAFKA_CLIENT_ID || 'notification-service',
                brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
                groupId: process.env.KAFKA_GROUP_ID || 'notification-consumer',
            },
            events: USER_EVENTS,
            serviceName: 'notification-service',
        }),
        SharedModule,
        TemplateModule,
        DispatcherModule,
        ProviderModule,
        BulkModule,
        EventHandlersModule,
    ],
})
export class NotificationModule { }
