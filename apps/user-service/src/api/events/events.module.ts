import { Module } from '@nestjs/common';
import { NotificationEventPublisher } from './notification-event.publisher';

@Module({
  providers: [NotificationEventPublisher],
  exports: [NotificationEventPublisher],
})
export class EventProcessorModule {}
