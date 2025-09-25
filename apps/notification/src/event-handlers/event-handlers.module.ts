// apps/notification/src/event-handlers/event-handlers.module.ts
import { Module } from '@nestjs/common';
import { UserServiceEventsHandler } from './services/user-service-events.handler';
import { EventController } from './controllers/event.controller';
import { EventMappingService } from './services/event-mapping.service';
import { DispatcherModule } from '../dispatcher/dispatcher.module';
import { SharedModule } from '../shared/shared.module';

@Module({
  imports: [
    DispatcherModule,
    SharedModule,
  ],
  controllers: [
    UserServiceEventsHandler,
    EventController,
  ],
  providers: [
    UserServiceEventsHandler,
    EventMappingService,
  ],
  exports: [
    EventMappingService,
  ],
})
export class EventHandlersModule {}
