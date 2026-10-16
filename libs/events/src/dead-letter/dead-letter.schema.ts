import { bigserial, index, integer, jsonb, serial, text, timestamp, uniqueIndex, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { eventSchema } from '../outbox/outbox.schema';

/**
 * 컨슈머 실패 기록 (#1016 8번, 스펙 §5.1). **켜는 앱(core·channel-adapter)의 drizzle config 에만** 물린다 —
 * outbox 스키마처럼 6개 앱에 물리면 무관한 `db:generate` 가 이 테이블을 조용히 끼워 넣는다
 * (`dead-letter.schema.spec.ts` 가 지킨다).
 *
 * 시각 칸은 전부 `withTimezone` 이다 — `now()` 와 JS `Date` 를 섞어 쓰고 서로 비교한다(outbox 의 `next_attempt_at` 주석과 같은 이유).
 */
export const dead_letters = eventSchema.table(
  'dead_letters',
  {
    id: serial('id').primaryKey(),
    consumerGroup: varchar('consumer_group', { length: 200 }).notNull(),
    handler: varchar('handler', { length: 200 }).notNull(),
    topic: varchar('topic', { length: 100 }).notNull(),
    sequenceKey: varchar('sequence_key', { length: 200 }),
    messageId: varchar('message_id', { length: 200 }).notNull(),
    eventType: varchar('event_type', { length: 100 }),
    envelope: jsonb('envelope').notNull(),
    kafkaPartition: integer('kafka_partition').notNull(),
    kafkaOffset: varchar('kafka_offset', { length: 40 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    errorName: varchar('error_name', { length: 200 }),
    errorMessage: text('error_message'),
    redriveCount: integer('redrive_count').notNull().default(0),
    firstFailedAt: timestamp('first_failed_at', { withTimezone: true }).notNull().defaultNow(),
    lastFailedAt: timestamp('last_failed_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    uqGroupHandlerMessage: uniqueIndex('uq_dead_letters_group_handler_message').on(
      table.consumerGroup,
      table.handler,
      table.messageId,
    ),
    // 보류 검사와 순서 조회가 탄다. 안 푼 행만 담아 작게 유지한다.
    unresolvedSequenceIdx: index('dead_letters_unresolved_sequence_idx')
      .on(table.consumerGroup, table.topic, table.sequenceKey, table.id)
      .where(sql`status in ('failed', 'held')`),
  }),
);

/** 사람이 한 조치 (스펙 §5.2). outbox 행과 dead letter 둘 다 여기 남는다 — outbox 테이블엔 칸을 더하지 않는다. */
export const failure_actions = eventSchema.table(
  'failure_actions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    targetKind: varchar('target_kind', { length: 20 }).notNull(),
    targetId: integer('target_id').notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    outcome: varchar('outcome', { length: 20 }).notNull(),
    actor: varchar('actor', { length: 100 }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetIdx: index('failure_actions_target_idx').on(table.targetKind, table.targetId),
  }),
);

export const deadLetterSchema = { dead_letters, failure_actions };
