// 스키마 상단 import에 index 추가
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  uniqueIndex,
  index, // ← index 추가
} from 'drizzle-orm/pg-core';

import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid'; // uuid v7 지원 라이브러리 사용

export const eventLogs = pgTable(
  'event_logs',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

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
      .$defaultFn(() => uuidv7()),
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
    idempotencyKey: varchar('idempotency_key', { length: 255 }),
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
    // 이 4키로 유니크 보장하고 싶다면 유지해도 됨 (비즈니스 키)
    uniqueIndex('uq_processed_source_event').on(table.source, table.eventType, table.resourceId, table.eventVersion),
    // ❌ 기존: uniqueIndex('idx_processed_status')...
    // ✅ 수정: 검색용 일반 인덱스
    index('idx_processed_status').on(table.status),
    index('idx_processed_created').on(table.createdAt),
  ],
);

// 🔹 채널-WMS 주문 매핑 테이블
// WMS는 CTO 구현체라 수정 불가, 어댑터에서 매핑 관리 필요
export const wmsOrderMappings = pgTable(
  'wms_order_mappings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 채널 정보
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(), // 'coupang', 'naver', 'medusa'
    channelOrderId: varchar('channel_order_id', { length: 255 }).notNull(), // 채널별 주문 ID

    // WMS 정보
    wmsOrderId: uuid('wms_order_id').notNull(), // WMS에서 반환받은 UUID
    wmsStatus: varchar('wms_status', { length: 50 }), // WMS 주문 상태 (캐시용)

    // 메타데이터
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // 채널+주문ID 조합으로 유니크 (WMS와 동일한 제약조건)
    uniqueIndex('uq_wms_mapping_channel_order').on(table.salesChannel, table.channelOrderId),
    // WMS UUID로 역방향 조회용
    index('idx_wms_mapping_wms_id').on(table.wmsOrderId),
    index('idx_wms_mapping_created').on(table.createdAt),
  ],
);

// 🔹 채널별 동기화 상태 영속화 테이블
export const syncStatuses = pgTable(
  'sync_statuses',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    // ← channelId 타입을 event_logs와 통일 권장 (uuid 쓸지 varchar 쓸지 결정)
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
    uniqueIndex('uq_sync_status_channel_data').on(table.channelId, table.dataType),
    // ❌ uniqueIndex → ✅ index
    index('idx_sync_status_status').on(table.status),
    index('idx_sync_status_last_sync').on(table.lastSyncAt),
  ],
);

// 🔹 미매핑 주문 계류 테이블 (채널 상품 → PIM Variant 매핑 대기)
export const pendingOrders = pgTable(
  'pending_orders',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 채널 정보
    channel: varchar('channel', { length: 50 }).notNull(), // 'coupang', 'naver'
    externalOrderId: varchar('external_order_id', { length: 255 }).notNull(),

    // 상태
    status: varchar('status', { length: 50 }).notNull().default('pending_mapping'),
    // 'pending_mapping' | 'processing' | 'completed' | 'failed'

    // 미매핑 항목 정보 (관리자 UI 표시용)
    unmappedItems: jsonb('unmapped_items')
      .$type<
        {
          channelItemId: string;
          channelItemName: string;
          channelOptionName?: string;
        }[]
      >()
      .notNull(),

    // 원본 주문 데이터 (재처리용)
    rawOrderEvent: jsonb('raw_order_event').notNull(),

    // 처리 정보
    retryCount: integer('retry_count').default(0),
    lastRetryAt: timestamp('last_retry_at'),
    processedAt: timestamp('processed_at'),
    errorMessage: text('error_message'),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    index('idx_pending_orders_status').on(table.status),
    index('idx_pending_orders_channel').on(table.channel),
    uniqueIndex('uq_pending_orders_external').on(table.channel, table.externalOrderId),
    index('idx_pending_orders_created').on(table.createdAt),
  ],
);

// 🔹 Outbox Events 테이블 (Transactional Outbox Pattern)
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 이벤트 식별
    eventType: varchar('event_type', { length: 100 }).notNull(), // 'OrderSyncCompleted', 'CommandExecuted' 등
    aggregateType: varchar('aggregate_type', { length: 50 }).notNull().default('ChannelAdapter'),
    aggregateId: varchar('aggregate_id', { length: 255 }).notNull(), // 채널별 주문/상품 ID (varchar)
    partitionKey: varchar('partition_key', { length: 255 }).notNull(), // Kafka 파티션 키

    // 페이로드
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata'), // correlationId, causationId 등

    // 상태 관리
    status: varchar('status', { length: 20 }).notNull().default('pending'),
    // 'pending' | 'processing' | 'published' | 'failed'

    // 재시도 관리
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at').defaultNow(),
    errorMessage: text('error_message'),

    // 타임스탬프
    createdAt: timestamp('created_at').notNull().defaultNow(),
    publishedAt: timestamp('published_at'),
    failedAt: timestamp('failed_at'),
  },
  (table) => [
    // 상태별 조회 최적화
    index('idx_outbox_status_created').on(table.status, table.createdAt),
    index('idx_outbox_pending_next_attempt').on(table.status, table.nextAttemptAt),
    // 파티션 키 인덱스
    index('idx_outbox_partition_key').on(table.partitionKey),
  ],
);

// 🔹 PIM-Medusa 상품 매핑 테이블
export const pimMedusaMappings = pgTable(
  'pim_medusa_product_mappings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // PIM 정보
    pimMasterId: uuid('pim_master_id').notNull(),
    pimVersionId: uuid('pim_version_id').notNull(),
    pimVersion: integer('pim_version').notNull(),

    // Medusa 정보
    medusaProductId: varchar('medusa_product_id', { length: 255 }).notNull(),
    medusaHandle: varchar('medusa_handle', { length: 255 }).notNull(), // pim-{masterId}

    // 동기화 정보
    syncStatus: varchar('sync_status', { length: 20 }).notNull().default('synced'),
    // 'synced' | 'pending' | 'failed'
    lastSyncedAt: timestamp('last_synced_at').notNull().defaultNow(),
    lastSyncAction: varchar('last_sync_action', { length: 20 }), // 'created' | 'updated' | 'deleted'

    // 에러 추적
    syncErrorCount: integer('sync_error_count').notNull().default(0),
    lastSyncError: text('last_sync_error'),

    // 타임스탬프
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    // PIM Master ID로 조회 (가장 빈번한 쿼리)
    uniqueIndex('uq_pim_medusa_master').on(table.pimMasterId),
    // Medusa Product ID로 역조회
    index('idx_pim_medusa_product').on(table.medusaProductId),
    // Medusa Handle로 조회
    index('idx_pim_medusa_handle').on(table.medusaHandle),
    // 동기화 상태별 조회
    index('idx_pim_medusa_sync_status').on(table.syncStatus),
    // 최근 동기화 시간 조회
    index('idx_pim_medusa_last_synced').on(table.lastSyncedAt),
  ],
);

// ===============================
// 전체 스키마 객체 Export (Drizzle ORM 규칙)
// ===============================
// 주의: DbService의 타입 체크를 위해 channelAdapterSchema만 사용하세요
// import * as schema를 사용하면 generateUUIDv7 같은 함수도 포함되어 타입 에러 발생
export const channelAdapterSchema = {
  eventLogs,
  syncHistories,
  processedEvents,
  wmsOrderMappings,
  syncStatuses,
  pendingOrders,
  outboxEvents,
  pimMedusaMappings, // ← 추가
} as const;

export type ChannelAdapterSchema = typeof channelAdapterSchema;
