// apps/notification/src/event-handlers/event-handlers.module.ts
import { Module } from '@nestjs/common';
import { UserServiceEventsHandler } from './services/user-service-events.handler';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    DispatcherModule,
    SharedModule,
  ],
  controllers: [
    UserServiceEventsHandler,
  ],
  providers: [
    UserServiceEventsHandler,
  ],
})
export class EventHandlersModule {}
