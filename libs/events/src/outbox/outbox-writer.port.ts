/**
 * Outbox Writer Port (ADR-0029 §5·§7)
 *
 * `StreamPublisher.enqueue` 가 검증을 끝낸 envelope 를 넘기는 자리. 발행 방향에 port 를 두는
 * 이유는 §7 과 같다 — 적재 대상(테이블·ORM)이 아니라 **"검증된 envelope 를 트랜잭션에 싣는다"**
 * 는 것만이 publisher 의 관심사다. 덕분에 `libs/events` 의 publisher 는 drizzle 을 몰라도 되고,
 * 스펙은 DB 없이 적재를 관찰할 수 있다.
 *
 * 구현체는 현재 `OutboxPublisher`(공용 `outbox_events` 테이블) 하나다. 앱 자체 outbox 5벌을
 * 회수하는 Task 6-C 가 이 port 뒤로 들어온다.
 */

import type { MessageEnvelope } from '@packages/event-contracts/types';
import type { DbTx } from './outbox.types';

/**
 * 아웃박스 한 행. `envelope.payload` 는 **이미 zod 파싱을 통과한 값**이다 —
 * 검증은 publisher 가 적재 전에 끝낸다(ADR-0029 §5).
 */
export interface OutboxRecord {
  topic: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  envelope: MessageEnvelope;

  /**
   * 멱등 키 (ADR-0029 §5-1, Task 6-C-2). **옵셔널이다** — 이 필드를 넘기지 않는 호출자
   * (core catalog · membership)의 동작은 그대로다.
   *
   * 중복을 실제로 막는 것은 이 필드가 아니라 테이블의 `unique(topic, event_type,
   * idempotency_key)` 다. 인스턴스는 재시작하고 프로세스는 여럿이므로, 애플리케이션 쪽
   * 기억은 방어선이 될 수 없다. `OutboxWriter` 구현은 그 제약과 충돌할 때 **던지지 않고
   * 넘어가야** 한다 — 같은 사실을 두 번 적재하려는 시도는 호출자의 도메인 트랜잭션을
   * 실패시킬 이유가 아니다.
   */
  idempotencyKey?: string;

  /**
   * Kafka 파티션 키 (ADR-0029 §5-1, Task 6-C-2). 여기 실리는 것은 `StreamPublisher` 가
   * **이미 해석을 끝낸 값**이다 — 호출자 지정 > 스트림 파생 > `aggregateId` 순.
   * 비어 있으면 디스패처가 `aggregateId` 로 폴백한다(컬럼이 생기기 전 동작).
   */
  partitionKey?: string;
}

export interface OutboxWriter {
  write(record: OutboxRecord, tx: DbTx): Promise<void>;
}
