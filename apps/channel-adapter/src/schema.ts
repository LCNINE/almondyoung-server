import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid'; // uuid v7 지원 라이브러리 사용

export function generateUUIDv7(): string {
  return uuidv7();
}

export const eventLogs = pgTable(
  'event_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),

    channelId: uuid('channel_id').notNull(),

    eventType: varchar('event_type', { length: 100 }).notNull(), // order_created, order_cancelled...

    // 외부 시스템 식별자
    externalOrderId: varchar('external_order_id', { length: 255 }).notNull(), // 원 주문 ID
    externalClaimId: varchar('external_claim_id', { length: 255 }), // 취소/환불/교환 ID (nullable)

    // 원본/변환 데이터
    rawData: jsonb('raw_data'),
    transformedData: jsonb('transformed_data'),

    // 처리 상태
    status: varchar('status', { length: 20 }).default('pending'), // pending, processed, failed
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').default(0),

    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    // 채널+주문+클레임 조합으로 유니크 인덱스(ClaimId 없을 때도 COALESCE)
    sql`CREATE UNIQUE INDEX unique_channel_event
         ON event_logs (channel_id, external_order_id, COALESCE(external_claim_id, ''))`,
    sql`CREATE INDEX idx_event_logs_status ON event_logs (status)`,
  ],
);

// 🔹 동기화 히스토리 테이블
export const syncHistories = pgTable(
  'sync_histories',
  {
    id: varchar('id', { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),
    channelId: uuid('channel_id').notNull(),

    syncType: varchar('sync_type', { length: 50 }).notNull(), // products, inventory, orders...
    status: varchar('status', { length: 20 }).notNull(), // success, partial, failed

    totalCount: integer('total_count').default(0),
    successCount: integer('success_count').default(0),
    failedCount: integer('failed_count').default(0),

    startedAt: timestamp('started_at').notNull(),
    completedAt: timestamp('completed_at'),
    errorDetails: jsonb('error_details'),

    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    sql`CREATE INDEX idx_sync_histories_channel ON sync_histories (channel_id)`,
    sql`CREATE INDEX idx_sync_histories_type ON sync_histories (sync_type)`,
    sql`CREATE INDEX idx_sync_histories_status ON sync_histories (status)`,
  ],
);

export const processedEvents = pgTable(
  'processed_events',
  {
    idempotencyKey: varchar('idempotency_key', { length: 255 }).primaryKey(),
    source: varchar('source', { length: 50 }).notNull(),
    eventType: varchar('event_type', { length: 50 }).notNull(),
    resourceId: varchar('resource_id', { length: 100 }).notNull(),
    eventVersion: varchar('event_version', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull().default('PROCESSED'),
    errorMessage: text('error_message'),
    retryCount: integer('retry_count').default(0),
    lastRetryAt: timestamp('last_retry_at'),
    createdAt: timestamp('created_at').default(sql`now()`),
    updatedAt: timestamp('updated_at').default(sql`now()`),
  },
  (table) => [
    uniqueIndex('idx_processed_source_event').on(
      table.source,
      table.eventType,
      table.resourceId,
      table.eventVersion,
    ),
    uniqueIndex('idx_processed_status').on(table.status),
    uniqueIndex('idx_processed_created').on(table.createdAt),
  ],
);
// 🔹 채널별 동기화 상태 영속화 테이블
export const syncStatuses = pgTable(
  'sync_statuses',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => generateUUIDv7()),
    channelId: varchar('channel_id', { length: 50 }).notNull(),
    dataType: varchar('data_type', { length: 50 }).notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    lastSyncAt: timestamp('last_sync_at'),
    lastEventCount: integer('last_event_count').default(0),
    totalSyncs: integer('total_syncs').default(0),
    successfulSyncs: integer('successful_syncs').default(0),
    failedSyncs: integer('failed_syncs').default(0),
    avgProcessingTimeMs: integer('avg_processing_time_ms').default(0),
    lastErrorMessage: text('last_error_message'),
    updatedAt: timestamp('updated_at').default(sql`now()`),
    createdAt: timestamp('created_at').default(sql`now()`),
  },
  (table) => [
    uniqueIndex('uq_sync_status_channel_data').on(
      table.channelId,
      table.dataType,
    ),
    uniqueIndex('idx_sync_status_status').on(table.status),
    uniqueIndex('idx_sync_status_last_sync').on(table.lastSyncAt),
  ],
);
