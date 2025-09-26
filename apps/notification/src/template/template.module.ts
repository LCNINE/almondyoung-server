import { Module } from '@nestjs/common';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { TemplateController } from './controllers/template.controller';
import { TemplateService } from './services/template.service';
import { TemplateRendererService } from '../shared/services/template-renderer.service';
import { ProviderModule } from '../provider/provider.module';

@Module({
    imports: [
        DbModule.forRoot({
            config: {
                connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
            },
            schema: notificationTables,
        }),
        ProviderModule, // ProviderManagerService와 ProviderFactory를 사용하기 위해 추가
    ],
    controllers: [TemplateController],
    providers: [
        TemplateService,
        TemplateRendererService,
    ],
    exports: [TemplateService],
})
export class TemplateModule { }
