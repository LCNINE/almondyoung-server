import { Module } from '@nestjs/common';
import { EventTraceQueryService } from './event-trace-query.service';
import { EventTraceReader } from './event-trace.reader';

/**
 * 이벤트 추적 조회 능력만 제공한다. **컨트롤러는 없다** — 라우팅과 인증은 앱이 소유한다 (#705).
 *
 * 쓰는 앱은 이 모듈을 import 한 뒤, 자기 앱의 인가 데코레이터를 붙인 컨트롤러를 직접 선언해
 * `controllers` 에 등록한다. `EventTraceQueryService` 를 주입하면 응답 정형은 다 끝나 있다.
 */
@Module({
  providers: [EventTraceReader, EventTraceQueryService],
  exports: [EventTraceReader, EventTraceQueryService],
})
export class EventTraceApiModule {}
