import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outbox_events } from './outbox.schema';

export type OutboxEvent = typeof outbox_events.$inferSelect;
export type NewOutboxEvent = typeof outbox_events.$inferInsert;

export type DbTx = Pick<PostgresJsDatabase<any>, 'insert'>;

/**
 * `DISCARDED` 는 사람이 종결한 행이다 (#1016 7번). 재시도를 소진한 `FAILED` 와 달리 더 이상
 * 발행 대상이 아니면서도, 같은 주문의 뒤 행을 막지 않는다 (`sequencedTopics`).
 */
export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED' | 'DISCARDED';

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

  /**
   * 실패 후 다음 시도까지의 대기(초) 표 (#1016 7번). 생략하면 `OUTBOX_RETRY_DELAYS_SECONDS`.
   * 합이 «굳기 전 버티는 시간»이다 — 기본표는 약 7분이라 그보다 긴 Kafka 장애는 행을 전부 `FAILED` 로 굳힌다.
   * `strictPartitionOrdering` 을 켠 앱에서 늘리면 재시도 중인 행이 그 파티션을 그만큼 붙잡는다.
   */
  retryDelaysSeconds?: readonly number[];

  /**
   * 이 토픽들의 행은 같은 `(topic, aggregate_id)` 의 **더 이른** `PENDING`·`PROCESSING`·`FAILED` 행이 있으면 고르지 않는다
   * (#1016 7번, 스펙 §8.2). 기본은 빈 목록 = 끔. `strictPartitionOrdering` 과 달리 `FAILED` 도 막는다 — 막히는 범위가
   * 주문 하나라 가용성 사고가 아니고, 굳은 앞 행을 사람이 다시 보내거나 종결(`DISCARDED`)하면 풀린다.
   *
   * **주문 생애 토픽만** 넣는다(최종 리뷰 B). 모든 토픽에 걸면 «마지막 값이 이긴다» 스트림(`ProductSellableQuantityChanged`
   * 등, 키가 품목)이 ① 주기(5초)마다 품목당 한 행만 나가 뜨거운 품목에 적체가 끝없이 쌓이고 ② 한 행이 굳으면 더 새 값이
   * 몇 시간씩 묶여 Medusa·마켓에 낡은 재고가 남는다. 목록 밖 토픽의 행은 이 옵션이 없던 때와 같다.
   * 토픽 이름 문자열 대신 스트림 상수(`X_STREAM.topic.topic`)로 적는다.
   */
  sequencedTopics?: readonly string[];
}
