import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '@app/db';
import { outbox_events } from './outbox.schema';
import { DbTx } from './outbox.types';
import { OutboxRecord, OutboxWriter } from './outbox-writer.port';

/**
 * 공용 아웃박스 테이블(`outbox_events`) 적재기.
 *
 * **envelope 조립과 검증은 하지 않는다** — 그건 `StreamPublisher.enqueue` 의 일이다(ADR-0029 §5).
 * 옛 `saveEvent` 는 topic·eventType 을 생문자열로 받아 envelope 를 직접 만들었고, 계약을 몰랐기
 * 때문에 zod 를 탈 수 없었다. 그것이 이 레포에서 아웃박스가 "검증되지 않는 쪽 경로"였던 이유다.
 * 이제 이 클래스는 이미 검증된 envelope 를 행으로 옮기기만 한다.
 */
@Injectable()
export class OutboxPublisher implements OutboxWriter {
  private readonly logger = new Logger(OutboxPublisher.name);

  constructor(private readonly dbService: DbService) {}

  private get db() {
    return this.dbService.db;
  }

  /**
   * **`onConflictDoNothing` 이 이 메서드의 멱등성이다** (ADR-0029 §5-1, Task 6-C-2).
   *
   * 같은 `(topic, event_type, idempotency_key)` 를 두 번 적재하려는 시도는 조용히 한 행으로
   * 수렴한다 — 던지면 호출자의 **도메인 트랜잭션 전체가 롤백**되므로, 이미 기록된 사실을
   * 다시 적재하려 했다는 이유로 재고 이동이나 출고를 되돌리게 된다. core 로컬 판본
   * (`inventory/shared/outbox/outbox.service.ts`)이 회수 전까지 하던 것과 같은 선택이다.
   *
   * 중복을 막는 주체는 이 코드가 아니라 **DB 제약**이라는 점이 중요하다. `onConflictDoNothing`
   * 은 제약이 있을 때만 의미가 있고, 제약이 없으면 두 행이 그대로 들어간다 — 그래서
   * `outbox-idempotency.spec.ts` 가 제약 없는 대조군을 나란히 두고 그 차이를 고정한다.
   *
   * `idempotencyKey` 가 없는 행은 제약이 NULL 을 서로 다르게 취급하므로(`NULLS DISTINCT`)
   * 이 절을 지나도 항상 적재된다 = 이 컬럼이 생기기 전 동작.
   */
  async write(record: OutboxRecord, tx: DbTx): Promise<void> {
    await tx
      .insert(outbox_events)
      .values({
        topic: record.topic,
        aggregateType: record.aggregateType,
        aggregateId: record.aggregateId,
        eventType: record.eventType,
        idempotencyKey: record.idempotencyKey,
        partitionKey: record.partitionKey,
        payload: record.envelope,
        status: 'PENDING',
      })
      .onConflictDoNothing();

    this.logger.debug(`Outbox event saved: ${record.eventType}`, {
      topic: record.topic,
      aggregateId: record.aggregateId,
    });
  }
}
