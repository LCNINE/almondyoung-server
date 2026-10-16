import { Module } from '@nestjs/common';
import { EventFailuresModule as EventFailuresCapability } from '@app/events';
import { ORDER_STREAM } from '@packages/event-contracts';
import { EventFailuresController } from './event-failures.controller';

/**
 * #1016 7·8번 — 이 모듈을 import 하는 순간 core 의 컨슈머 실패가 `.dlq` 토픽 대신 `event.dead_letters` 로 간다.
 * 보류(같은 순서 키 지키기)는 core 가 소비하는 주문 생애 토픽만 — 이유는 `EventFailuresOptions.sequencedTopics` 주석.
 */
@Module({
  imports: [EventFailuresCapability.forRoot({ sequencedTopics: [ORDER_STREAM.topic.topic] })],
  controllers: [EventFailuresController],
})
export class CoreEventFailuresModule {}
