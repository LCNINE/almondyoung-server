// apps/notification/src/dispatcher/dispatcher.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { DbModule } from '@app/db';
import { EventsModule } from '@app/events';
import { SharedModule } from '../shared/shared.module';

import { ProviderModule } from '../provider/provider.module';
import { NotificationDispatcherService } from './services/notification-dispatcher.service';
import { NotificationController } from './controllers/notification.controller';
import { NotificationProcessor } from './processors/notification.processor';

@Module({
  imports: [
    DbModule,

    ProviderModule,
    EventsModule,
    SharedModule,
    BullModule.registerQueue({
      name: 'notification',
    }),
  ],
  controllers: [NotificationController],
  providers: [
    NotificationDispatcherService,
    NotificationProcessor,
  ],
  exports: [NotificationDispatcherService],
})
export class DispatcherModule {}
