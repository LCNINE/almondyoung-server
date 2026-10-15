import { Module } from '@nestjs/common';
import { EventFailuresModule as EventFailuresCapability } from '@app/events';
import { EventFailuresController } from './event-failures.controller';

/** #1016 7·8번 — 이 모듈을 import 하는 순간 core 의 컨슈머 실패가 `.dlq` 토픽 대신 `event.dead_letters` 로 간다 */
@Module({
  imports: [EventFailuresCapability],
  controllers: [EventFailuresController],
})
export class CoreEventFailuresModule {}
