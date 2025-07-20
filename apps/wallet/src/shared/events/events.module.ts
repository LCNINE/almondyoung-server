import { Module, Global } from '@nestjs/common';
import { EventLoggerService } from './event-logger.service';
import { EventProcessorService } from './event-processor.service';

/**
 * 이벤트 처리를 위한 글로벌 모듈
 * 모든 도메인에서 이벤트 서비스를 사용할 수 있도록 글로벌로 설정
 */
@Global()
@Module({
  providers: [
    EventLoggerService,
    EventProcessorService,
  ],
  exports: [
    EventLoggerService,
    EventProcessorService,
  ],
})
export class EventsModule {}