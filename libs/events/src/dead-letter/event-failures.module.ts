import { Module } from '@nestjs/common';
import { DeadLetterRedriver } from './dead-letter.redriver';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { DeadLetterStore } from './dead-letter.store';
import { FailureActionLog } from './failure-action.log';
import { OutboxFailuresService } from '../outbox/outbox-failures.service';

/**
 * 이벤트 실패 출구 (#1016 7·8번). **앱이 이 모듈을 import 하면 켜진다** — `startConsumer` 가 컨테이너에서
 * `DeadLetterRuntime` 을 찾아 그룹·서버를 붙이고, 인터셉터가 `.dlq` 토픽 대신 `event.dead_letters` 에 적는다.
 * 그 앱의 drizzle config 에 `dead-letter.schema.ts` 가 있어야 한다.
 *
 * 컨트롤러는 없다 — 앱마다 전역 가드가 달라 라우팅·인가는 앱이 소유한다(#705, `EventTraceApiModule` 과 같은 이유).
 */
@Module({
  providers: [DeadLetterStore, FailureActionLog, DeadLetterRuntime, DeadLetterRedriver, OutboxFailuresService],
  exports: [DeadLetterStore, FailureActionLog, DeadLetterRuntime, DeadLetterRedriver, OutboxFailuresService],
})
export class EventFailuresModule {}
