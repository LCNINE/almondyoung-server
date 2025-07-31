// apps/notification/src/template/template.module.ts
import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { TemplateController } from './controllers/template.controller';
import { TemplateService } from './services/template.service';
import { SharedModule } from '../shared/shared.module';

@Module({
    imports: [
        DbModule.forRoot({
            config: {
                connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
            },
            schema: notificationTables,
        }),
        SharedModule,
    ],
    controllers: [TemplateController],
    providers: [TemplateService],
    exports: [TemplateService],
})
export class TemplateModule { }