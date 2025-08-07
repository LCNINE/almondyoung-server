import { Global, Module } from '@nestjs/common';
import { NotificationEventPublisher } from './notification-event.publisher';

@Global()
@Module({
  providers: [NotificationEventPublisher],
  exports: [NotificationEventPublisher],
})
export class EventProcessorModule {}
