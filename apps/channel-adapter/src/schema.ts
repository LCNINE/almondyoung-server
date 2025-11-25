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
    uniqueIndex('uq_processed_source_event').on(
      table.source,
      table.eventType,
      table.resourceId,
      table.eventVersion,
    ),
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
    uniqueIndex('uq_wms_mapping_channel_order').on(
      table.salesChannel,
      table.channelOrderId,
    ),
    // WMS UUID로 역방향 조회용
    index('idx_wms_mapping_wms_id').on(table.wmsOrderId),
    index('idx_wms_mapping_created').on(table.createdAt),
  ],
);

// 🔹 채널 상품 → PIM Variant 매핑 테이블
// 외부 채널의 상품 ID를 PIM의 variantId에 매핑 (N:1 관계)
export const channelProductMappings = pgTable(
  'channel_product_mappings',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 채널 정보
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(), // 'coupang', 'naver'
    channelProductId: varchar('channel_product_id', { length: 255 }).notNull(), // 쿠팡 vendorItemId, 네이버 productOrderId 등
    channelProductName: varchar('channel_product_name', { length: 500 }), // 채널에서 보여주는 상품명 (참고용)

    // PIM 매핑 정보
    pimVariantId: uuid('pim_variant_id').notNull(), // PIM의 variant ID
    pimVariantCode: varchar('pim_variant_code', { length: 100 }), // 조회 편의용 캐시

    // 메타데이터
    mappedBy: varchar('mapped_by', { length: 100 }), // 매핑한 관리자
    mappedAt: timestamp('mapped_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // 채널 + 채널상품ID 조합으로 유니크 (pimVariantId는 유니크 아님 - N:1 허용)
    uniqueIndex('uq_channel_product_mapping').on(
      table.salesChannel,
      table.channelProductId,
    ),
    // PIM variant로 역조회 (어떤 채널 상품들이 이 variant에 매핑되어 있나?)
    index('idx_channel_mapping_variant').on(table.pimVariantId),
    index('idx_channel_mapping_channel').on(table.salesChannel),
  ],
);

// 🔹 계류 주문 테이블
// 채널 상품 매핑이 없어서 처리할 수 없는 주문을 임시 보관
export const pendingOrders = pgTable(
  'pending_orders',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    // 채널 정보
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    channelOrderId: varchar('channel_order_id', { length: 255 }).notNull(),
    channelProductId: varchar('channel_product_id', { length: 255 }).notNull(), // 매핑 안 된 상품 ID
    channelProductName: varchar('channel_product_name', { length: 500 }), // 상품명 (관리자 참고용)

    // 원본 주문 데이터 (재처리용)
    orderData: jsonb('order_data').notNull(), // InternalOrderEvent 전체 저장

    // 상태
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, processed, cancelled
    reason: varchar('reason', { length: 50 }).default('unmapped_product'), // pending 사유

    // 처리 정보
    processedAt: timestamp('processed_at'),
    processedBy: varchar('processed_by', { length: 100 }),

    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    // 같은 채널의 같은 주문은 하나만 계류 가능
    uniqueIndex('uq_pending_channel_order').on(
      table.salesChannel,
      table.channelOrderId,
    ),
    index('idx_pending_status').on(table.status),
    index('idx_pending_product').on(table.channelProductId),
    index('idx_pending_created').on(table.createdAt),
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
    uniqueIndex('uq_sync_status_channel_data').on(
      table.channelId,
      table.dataType,
    ),
    // ❌ uniqueIndex → ✅ index
    index('idx_sync_status_status').on(table.status),
    index('idx_sync_status_last_sync').on(table.lastSyncAt),
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
  channelProductMappings,
  pendingOrders,
  syncStatuses,
} as const;

export type ChannelAdapterSchema = typeof channelAdapterSchema;
