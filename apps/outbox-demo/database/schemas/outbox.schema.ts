import { pgTable, serial, varchar, jsonb, timestamp, integer, text, index } from 'drizzle-orm/pg-core';

export const outbox_events = pgTable('outbox_events', {
  id: serial('id').primaryKey(),

  // 이벤트 식별
  aggregateType: varchar('aggregate_type', { length: 50 }).notNull(),
  aggregateId: varchar('aggregate_id', { length: 100 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),

  // 페이로드
  payload: jsonb('payload').notNull(),
  metadata: jsonb('metadata'),

  // 추적 정보
  correlationId: varchar('correlation_id', { length: 100 }),
  causationId: varchar('causation_id', { length: 100 }),

  // 상태 관리
  status: varchar('status', { length: 20 }).notNull().default('PENDING'),
  // 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED'

  // 타임스탬프
  createdAt: timestamp('created_at').notNull().defaultNow(),
  publishedAt: timestamp('published_at'),
  failedAt: timestamp('failed_at'),

  // 재시도 관리
  retryCount: integer('retry_count').notNull().default(0),
  errorMessage: text('error_message'),
}, (table) => ({
  statusIdx: index('outbox_status_idx').on(table.status, table.createdAt),
}));

export type OutboxEvent = typeof outbox_events.$inferSelect;
export type NewOutboxEvent = typeof outbox_events.$inferInsert;
