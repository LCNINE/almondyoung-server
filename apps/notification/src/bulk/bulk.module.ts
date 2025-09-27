import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { notificationTables } from '../../database/schemas/notification-schema';
import { BulkNotificationController } from './controllers/bulk-notification.controller';
import { BulkNotificationService } from './services/bulk-notification.service';
import { BulkNotificationProcessor } from './processors/bulk-notification.processor';
import { SharedModule } from '../shared/shared.module';
import { DispatcherModule } from '../dispatcher/dispatcher.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'bulk-notification' }),
    DbModule.forRoot({
      config: {
        connectionString: process.env.NOTIFICATION_DATABASE_URL ?? '',
      },
      schema: notificationTables,
    }),
    SharedModule,
    DispatcherModule,
  ],
  controllers: [BulkNotificationController],
  providers: [BulkNotificationService, BulkNotificationProcessor],
  exports: [BulkNotificationService],
})
export class BulkModule {}
