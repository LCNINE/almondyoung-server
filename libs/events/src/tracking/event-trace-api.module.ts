import { Module } from '@nestjs/common';
import { EventTraceController } from './event-trace.controller';
import { EventTraceReader } from './event-trace.reader';

@Module({
  controllers: [EventTraceController],
  providers: [EventTraceReader],
  exports: [EventTraceReader],
})
export class EventTraceApiModule {}
