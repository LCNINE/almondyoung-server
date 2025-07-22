import { Module } from '@nestjs/common';
import { EventMonitorService } from './event-monitor.service';
import { EventMonitorController } from './event-monitor.controller';
import { EventReplayService } from './event-replay.service';
import { EventReplayController } from './event-replay.controller';

/**
 * 이벤트 모니터링 및 재생 모듈
 * 모든 도메인의 이벤트를 중앙에서 수집, 모니터링하고 이벤트 재생 기능을 제공합니다.
 */
@Module({
  providers: [
    EventMonitorService,
    EventReplayService, // ✅ 이벤트 재생 서비스 등록
  ],
  controllers: [
    EventMonitorController,
    EventReplayController, // ✅ 이벤트 재생 컨트롤러 등록
  ],
  exports: [
    EventMonitorService,
    EventReplayService, // ✅ 다른 모듈에서 사용할 수 있도록 export
  ],
})
export class EventMonitorModule {}