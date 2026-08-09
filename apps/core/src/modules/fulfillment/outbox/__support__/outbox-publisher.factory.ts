import type { DbService } from '@app/db';
import { OutboxPublisher, StreamPublisher } from '@app/events';
import type { StreamConfig, StreamEventTypes } from '@packages/event-contracts/types';

/**
 * 통합 스펙용 `StreamPublisher` — **실제 `event.outbox_events` 에 적재한다**
 * (ADR-0029 §5-1, Task 6-C-2).
 *
 * 회수 전에는 하네스들이 `new OutboxService(dbService)` 를 만들어 서비스에 넘겼다. 이제
 * 서비스가 받는 것은 스트림별 publisher 이므로 하네스도 같은 것을 만들어야 하는데, **가짜를
 * 쓰면 안 된다** — 이 스펙들이 확인하는 것 중 하나가 "정확히 어떤 아웃박스 행이 생기는가"
 * (`expectExactOutboxTopology`)이고, 그건 실제 적재를 관찰해야 뜻이 있다.
 *
 * transport 는 닿지 않는다 — `enqueue` 는 행만 남기고 발행은 디스패처의 일이다. 그래서
 * 여기서는 절대 호출되지 않는 stub 을 넣고, 혹시 호출되면 조용히 넘어가는 대신 던지게 한다.
 *
 * 검증은 **켠 채로 둔다**(기본값). 하네스가 검증을 끄면 계약을 어긴 payload 가 스펙에서만
 * 통과하고 프로덕션에서 poison 행이 된다 — 이 조각이 재고 이벤트 3종에서 발견한 것이 정확히
 * 그 모양이었다.
 */
export function outboxPublisherFor<TEvents extends StreamEventTypes>(
  stream: StreamConfig<TEvents>,
  dbService: unknown,
): StreamPublisher<TEvents> {
  return new StreamPublisher<TEvents>(
    {
      send: () => {
        throw new Error('통합 하네스의 publisher 는 적재만 한다 — transport 로 나갈 일이 없다');
      },
    } as never,
    stream,
    'core-integration-harness',
    undefined,
    undefined,
    undefined,
    new OutboxPublisher(dbService as DbService),
  );
}
