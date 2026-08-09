import { pgSchema } from 'drizzle-orm/pg-core';
import { serial, varchar, jsonb, timestamp, integer, text, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const eventSchema = pgSchema('event');

/**
 * 공용 아웃박스 테이블. **각 앱이 자기 DB 의 `event.outbox_events` 를 쓴다** (ADR-0029 §5-1 (B)).
 * 앱마다 DB 가 다르므로 행 이관은 없고, 테이블 모양이 하나이므로 서술자 추상화도 필요 없다.
 *
 * 이 파일은 6개 앱(analytics · channel-adapter · core · file-service · membership · wallet)의
 * `drizzle.config.ts` 가 **전부 schema 목록에 물고 있다**. 여기를 고치면 그 6개 앱 모두에
 * 마이그레이션이 생긴다 — 하나라도 빠뜨리면 다음 무관한 `db:generate` 가 이 변경을 조용히
 * 그 마이그레이션에 끼워 넣는다.
 */
export const outbox_events = eventSchema.table(
  'outbox_events',
  {
    id: serial('id').primaryKey(),

    // Stream 정보
    topic: varchar('topic', { length: 100 }).notNull(),

    // 이벤트 식별
    aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
    aggregateId: varchar('aggregate_id', { length: 100 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),

    /**
     * 멱등 키 (ADR-0029 §5-1 승격, Task 6-C-1).
     *
     * **nullable 이다** — core 로컬 판본은 NOT NULL 이지만 여기서 그럴 수 없다. 이미 적재된
     * 행에 값이 없고, 이 조각은 호출자를 고치지 않기 때문이다(`OutboxPublisher.write` 는
     * 아직 이 컬럼을 채우지 않는다). 아래 unique 제약이 기존 행을 막지 않는 것도 같은 이유다 —
     * Postgres 의 unique 는 NULL 을 서로 다르게 취급한다(`NULLS DISTINCT`, PG15+ 기본값).
     * 실제 값이 들어오는 것은 core 호출자를 회수하는 Task 6-C-2 부터다.
     */
    idempotencyKey: varchar('idempotency_key', { length: 255 }),

    /**
     * Kafka 파티션 키 (ADR-0029 §5-1 승격). 비어 있으면 디스패처가 `aggregateId` 로 폴백하며,
     * 그것이 이 컬럼이 생기기 전의 동작이다.
     */
    partitionKey: varchar('partition_key', { length: 128 }),

    // 페이로드 (MessageEnvelope 전체)
    payload: jsonb('payload').notNull(),

    // 상태 관리
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),

    // 타임스탬프
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processingStartedAt: timestamp('processing_started_at'),
    publishedAt: timestamp('published_at'),
    failedAt: timestamp('failed_at'),

    /**
     * 다음 시도 예정 시각 — **예약 재시도(지수 백오프)** 의 근거 (ADR-0029 §5-1).
     *
     * 이 컬럼이 생기기 전 공용 디스패처는 실패한 행을 5초마다 즉시 재시도했다. `NOT NULL
     * DEFAULT now()` 이므로 기존 행은 마이그레이션 직후 곧바로 자격을 얻는다 = 옛 동작 그대로.
     *
     * **이 테이블에서 유일하게 `withTimezone` 이다** — core 로컬 판본과 같은 선택이고, 이유가
     * 있다. 이 컬럼만이 *DB 가 쓴 값*(`DEFAULT now()`)과 *앱이 쓴 값*(JS `Date`)을 **서로 비교**
     * 한다. 나머지 컬럼은 한쪽만 쓰거나 비교하지 않는다. `timestamp`(without tz)면 앞의 것은
     * 세션 TZ 로, 뒤의 것은 UTC 로 저장돼 그 차이만큼 백오프가 어긋난다 — 세션 TZ 가 UTC 인
     * 환경에서는 무증상이라 더 나쁘다.
     */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),

    // 재시도 관리
    retryCount: integer('retry_count').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => ({
    statusIdx: index('outbox_status_idx').on(table.status, table.createdAt),
    processingStartedIdx: index('outbox_processing_started_idx').on(table.status, table.processingStartedAt),
    topicIdx: index('outbox_topic_idx').on(table.topic),
    // 디스패처의 acquire 조건과 같은 모양 — status + next_attempt_at
    statusNextAttemptIdx: index('outbox_status_next_attempt_idx').on(table.status, table.nextAttemptAt),
    /**
     * 파티션 순서 보장(`OutboxConfig.strictPartitionOrdering`)의 상관 서브쿼리를 받는 인덱스
     * (Task 6-C-3). 그 술어는 후보 행마다 "같은 partition_key 의 더 이른 미발행 행"을 찾으므로,
     * 이 인덱스가 없으면 아웃박스가 밀린 순간 스캔량이 `배치 × 백로그` 로 커진다 — 정확히
     * 장애 중에 나빠지는 모양이다. wallet 로컬 판본이 같은 목적의
     * `idx_outbox_events_partition_created_at` 를 갖고 있었고, 회수하면서 함께 옮긴다.
     *
     * 순서 보장을 켜지 않은 앱(core · membership · analytics · file-service · channel-adapter)
     * 에서는 쓰이지 않는다. 그래도 스키마가 한 벌이라 6개 앱 전부에 생성된다 — 쓰기 비용은
     * 인덱스 하나분이고, 앱마다 다른 스키마를 두는 쪽이 훨씬 비싸다.
     */
    partitionCreatedIdx: index('outbox_partition_created_idx').on(table.partitionKey, table.createdAt),
    // 이름에 `event_` 를 넣은 이유: core DB 에는 `public.outbox_events` 에 같은 목적의
    // `uq_outbox_topic_event_idempotency` 가 이미 있다. 스키마가 달라 충돌하지는 않지만,
    // 6-C-4 로 옛 테이블이 사라지기 전까지 한 DB 안에 같은 이름이 둘 보이는 것을 피한다.
    uqTopicEventIdempotency: uniqueIndex('uq_event_outbox_topic_event_idempotency').on(
      table.topic,
      table.eventType,
      table.idempotencyKey,
    ),
  }),
);

export const outboxSchema = {
  outbox_events,
};
