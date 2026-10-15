import { DynamicModule, Module } from '@nestjs/common';
import { DeadLetterRedriver } from './dead-letter.redriver';
import { DeadLetterQueryService } from './dead-letter.query';
import { DeadLetterRuntime } from './dead-letter.runtime';
import { DeadLetterStore } from './dead-letter.store';
import { FailureActionLog } from './failure-action.log';
import { OutboxFailuresService } from '../outbox/outbox-failures.service';
import { DeadLetterMetricsCollector } from './dead-letter-metrics.collector';
import { EVENT_FAILURES_OPTIONS, type EventFailuresOptions } from './event-failures.options';
import { SCHEDULE_ROOT } from '@app/shared/schedule/schedule-root';

/**
 * 이벤트 실패 출구 (#1016 7·8번). **앱이 `EventFailuresModule.forRoot(...)` 를 import 하면 켜진다** — `startConsumer` 가
 * 컨테이너에서 `DeadLetterRuntime` 을 찾아 그룹·서버를 붙이고, 인터셉터가 `.dlq` 토픽 대신 `event.dead_letters` 에 적는다.
 * 그 앱의 drizzle config 에 `dead-letter.schema.ts` 가 있어야 하고, 테이블이 없으면 `startConsumer` 가 켜지 않는다.
 *
 * 순서(보류)를 지킬 토픽은 앱이 고른다 — `EventFailuresOptions.sequencedTopics` 주석.
 *
 * 컨트롤러는 없다 — 앱마다 전역 가드가 달라 라우팅·인가는 앱이 소유한다(#705, `EventTraceApiModule` 과 같은 이유).
 */
@Module({})
export class EventFailuresModule {
  static forRoot(options: EventFailuresOptions): DynamicModule {
    return {
      module: EventFailuresModule,
      imports: [SCHEDULE_ROOT],
      providers: [
        { provide: EVENT_FAILURES_OPTIONS, useValue: { sequencedTopics: [...options.sequencedTopics] } },
        DeadLetterStore,
        FailureActionLog,
        DeadLetterRuntime,
        DeadLetterRedriver,
        DeadLetterQueryService,
        OutboxFailuresService,
        DeadLetterMetricsCollector,
      ],
      exports: [
        DeadLetterStore,
        FailureActionLog,
        DeadLetterRuntime,
        DeadLetterRedriver,
        DeadLetterQueryService,
        OutboxFailuresService,
        EVENT_FAILURES_OPTIONS,
      ],
    };
  }
}
