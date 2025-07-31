// apps/notification/src/notification.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from '@app/db';
import { notificationTables } from '../database/schemas/notification-schema';

import { TemplateModule } from './template/template.module';
import { DispatcherModule } from './dispatcher/dispatcher.module';
import { ProviderModule } from './provider/provider.module';
import { CampaignModule } from './campaign/campaign.module';
import { SharedModule } from './shared/shared.module';

@Module({
    imports: [
        ConfigModule.forRoot(),
        DbModule.forRoot({
            config: {
                connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
            },
            schema: notificationTables,
        }),


        SharedModule,
        TemplateModule,
        DispatcherModule,
        ProviderModule,
        CampaignModule,
    ],
})
export class NotificationModule { }