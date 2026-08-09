import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outbox_events } from './outbox.schema';

export type OutboxEvent = typeof outbox_events.$inferSelect;
export type NewOutboxEvent = typeof outbox_events.$inferInsert;

export type DbTx = Pick<PostgresJsDatabase<any>, 'insert'>;

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export interface OutboxConfig {
  dispatchIntervalMs?: number; // 기본값: 5000
  batchSize?: number; // 기본값: 100
  maxRetries?: number; // 기본값: 5
  processingTimeoutMs?: number; // 기본값: 300000 (5분)
  cleanupDays?: number; // 기본값: 7

  /**
   * 같은 `partition_key` 안에서 **적재 순서대로만** 발행한다 (기본: `false`, Task 6-C-3).
   *
   * 끄면(기본) 실패한 행이 백오프를 기다리는 동안 뒤 행이 먼저 나간다. 그러면 Kafka
   * 파티션 안의 순서가 적재 순서와 갈라지는데, 파티션 키를 지정한 이유가 보통 그 순서이므로
   * 조용한 손실이 된다 — 예: `payment.intent.created` 가 재시도 중일 때
   * `payment.intent.captured` 가 먼저 도착한다.
   *
   * 켜면 앞 행이 `PENDING`/`PROCESSING` 인 동안 뒤 행이 **선택되지 않는다.** 대가는
   * head-of-line blocking 이다 — 한 행이 재시도를 소진할 때까지 그 파티션이 막힌다.
   * 그래서 기본값이 아니라 **앱이 고르는 성질**이다. wallet 로컬 디스패처가 이것을 갖고
   * 있었고 회수하면서 옮겼다(ADR-0029 §5-1).
   *
   * `partition_key` 가 NULL 인 행은 서로 막지 않는다 — SQL 의 `=` 가 NULL 을 같다고 하지
   * 않기 때문이며, 이 컬럼이 생기기 전에 적재된 행에 대해 그 편이 안전하다.
   */
  strictPartitionOrdering?: boolean;
}
