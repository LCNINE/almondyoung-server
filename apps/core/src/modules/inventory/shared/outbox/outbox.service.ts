import { Injectable } from '@nestjs/common';
import { DbService } from '@app/db';
import { wmsTables, wmsSchema, DbTx } from '../../schema/inventory.schema';
import { and, eq } from 'drizzle-orm';

// core 안에서 `wmsTables.outboxEvents` 에 적재하는 **유일한** 진입점이다.
// 2026-08-09(ADR-0029 Task 0)까지는 `fulfillment/outbox/outbox.service.ts` 에 import 경로 한 줄만
// 다른 사본이 하나 더 있었다. 두 사본은 같은 테이블에 썼으므로 갈라지면 조용히 어긋났을 것이다.
// 회수 대상은 이 파일 하나다 — Task 6-C-2 가 여기를 `StreamPublisher.enqueue` 로 옮긴다.
//
// topic 과 idempotencyKey 는 필수다 — topicless V1 expand 호환 갈래는 Task 25 에서 제거됐고,
// 새 topicless write 는 컴파일 단계에서 막힌다 (dispatcher 폴백 라우팅도 함께 제거됨).
type OutboxEnqueueParams = {
  topic: string;
  idempotencyKey: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  partitionKey: string;
  payload: unknown;
};

@Injectable()
export class OutboxService {
  constructor(private readonly db: DbService<typeof wmsSchema>) {}

  async enqueue(params: OutboxEnqueueParams, tx?: DbTx) {
    const exec = async (trx: DbTx) => {
      const [inserted] = await trx
        .insert(wmsTables.outboxEvents)
        .values({
          topic: params.topic,
          idempotencyKey: params.idempotencyKey,
          eventType: params.eventType,
          aggregateType: params.aggregateType,
          aggregateId: params.aggregateId,
          partitionKey: params.partitionKey,
          payload: params.payload as any,
          status: 'pending',
        })
        .onConflictDoNothing()
        .returning();

      if (inserted) return inserted;

      const [existing] = await trx
        .select()
        .from(wmsTables.outboxEvents)
        .where(
          and(
            eq(wmsTables.outboxEvents.topic, params.topic),
            eq(wmsTables.outboxEvents.eventType, params.eventType),
            eq(wmsTables.outboxEvents.idempotencyKey, params.idempotencyKey),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error('Outbox idempotency conflict did not resolve to an existing row');
      }
      return existing;
    };
    if (tx) return exec(tx);
    return this.db.db.transaction(exec);
  }
}
