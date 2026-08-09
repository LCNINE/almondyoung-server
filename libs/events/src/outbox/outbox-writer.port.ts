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
}

export interface OutboxWriter {
  write(record: OutboxRecord, tx: DbTx): Promise<void>;
}
