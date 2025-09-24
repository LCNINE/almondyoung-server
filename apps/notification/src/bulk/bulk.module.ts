// apps/notification/src/bulk/bulk.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { BulkNotificationController } from './controllers/bulk-notification.controller';
import { BulkNotificationService } from './services/bulk-notification.service';
import { BulkProcessor } from './processors/bulk.processor';
import { ProviderModule } from '../provider/provider.module';
import { TemplateModule } from '../template/template.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'bulk-notification' }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    ProviderModule,
    TemplateModule,
    SharedModule,
  ],
  controllers: [BulkNotificationController],
  providers: [
    BulkNotificationService,
    BulkProcessor,
  ],
  exports: [BulkNotificationService],
})
export class BulkModule { }
