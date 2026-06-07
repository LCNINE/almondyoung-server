import { pgSchema } from 'drizzle-orm/pg-core';
import { serial, varchar, jsonb, timestamp, integer, text, index } from 'drizzle-orm/pg-core';

export const eventSchema = pgSchema('event');

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

    // 페이로드 (MessageEnvelope 전체)
    payload: jsonb('payload').notNull(),

    // 상태 관리
    status: varchar('status', { length: 20 }).notNull().default('PENDING'),

    // 타임스탬프
    createdAt: timestamp('created_at').notNull().defaultNow(),
    processingStartedAt: timestamp('processing_started_at'),
    publishedAt: timestamp('published_at'),
    failedAt: timestamp('failed_at'),

    // 재시도 관리
    retryCount: integer('retry_count').notNull().default(0),
    errorMessage: text('error_message'),
  },
  (table) => ({
    statusIdx: index('outbox_status_idx').on(table.status, table.createdAt),
    processingStartedIdx: index('outbox_processing_started_idx').on(table.status, table.processingStartedAt),
    topicIdx: index('outbox_topic_idx').on(table.topic),
  }),
);

export const outboxSchema = {
  outbox_events,
};
