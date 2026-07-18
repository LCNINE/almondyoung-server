// ../../schema/inventory.schema.ts
import { sql, eq, type InferSelectModel, type InferInsertModel, InferSelectViewModel } from 'drizzle-orm';
import {
  pgTable,
  pgView,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  json,
  jsonb,
  text,
  pgEnum,
  primaryKey,
  unique,
  decimal,
  date,
  index,
  uniqueIndex,
  check,
  foreignKey,
  AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { authorizationSchema } from '@app/authorization';

/*───────────────────────────
 * ENUM DECLARATIONS
 *──────────────────────────*/
export const sourceTypeEnum = pgEnum('source_type', ['direct', 'in_house', 'overseas']);

export const eventStatusEnum = pgEnum('event_status', ['PENDING', 'POSTED', 'VOIDED']);
export const stockStateEnum = pgEnum('stock_state', [
  'ON_HAND', // 출고가능 or 가용재고
  'DEFECTIVE', // 불량
  'IN_TRANSFER', // 창고간 운송중
]);
/** 상태 전이 타입(enum) */
export const transitionTypeEnum = pgEnum('transition_type', [
  // 기본 흐름
  'RECEIVE', // null → ON_HAND (입고)
  'SHIP', // ON_HAND → null (출고) - 예약 없이 직접 출고
  'MOVE', // 이동 (창고내/창고간 통합)

  // 품질 관리
  'MARK_DEFECT', // ON_HAND → DEFECTIVE (불량 지정) — DEAD(producer 0, 작업4 이후), 제거 예정: dev DB 복구 후(현황판 작업8b)
  'REWORK_GOOD', // DEFECTIVE → ON_HAND (불량 양품화) — DEAD(producer 0, 작업4 이후), 제거 예정: dev DB 복구 후(현황판 작업8b)
  'SCRAP', // (ON_HAND|DEFECTIVE) → null (폐기)

  // 수동 조정 (reason 필드로 상세 사유 기록)
  'ADJUST_UP', // null → ON_HAND (재고 증가)
  'ADJUST_DOWN', // ON_HAND → null (재고 감소)
]);

// 창고 타입 추가
export const warehouseTypeEnum = pgEnum('warehouse_type', ['domestic', 'overseas', 'bonded', 'return']);

// DEAD 값(producer 0) — 제거 예정: dev DB 복구 후(현황판 작업8b). 'pending'(컬럼 default이나 실 insert는 항상 'confirmed')·'active'. 라이브: confirmed/released.
export const reservationStatusEnum = pgEnum('reservation_status', ['pending', 'confirmed', 'released', 'active']);
export const taskStatusEnum = pgEnum('task_status', ['created', 'picking', 'packed', 'shipped', 'canceled']);
export const unavailableReasonEnum = pgEnum('unavailable_reason', ['pb', 'foreign', 'low_margin']);
// V1 'open'(lazy open-box) 은 Task 25 contract 에서 제거됨 — V2 shipment 는 항상 'draft' 로 시작한다.
// 'in_transit'/'delivered' 는 LIVE (Task 19 delivery projection = shipment-delivery-tracking.service).
// 'failed' 는 현재 producer 0 이나 향후 배송 실패 상태로 보존. (delivery-provider의 DeliveryStatus는 별개 타입)
export const shipmentStatusEnum = pgEnum('shipment_status', [
  'shipped',
  'in_transit',
  'delivered',
  'failed',
  'canceled',
  // Outbound V2 states.
  'draft',
  'planned',
  'superseded',
  'recovery_required',
]);
export const carrierEnum = pgEnum('carrier', ['CJ', 'HANJIN', 'LOTTE', 'LOGEN', 'KDEXP', 'CJGLS']);
export const returnStatusEnum = pgEnum('return_status', [
  'requested',
  'received',
  'qc_passed',
  'qc_failed',
  'disposed',
]);
export const matchingStatusEnum = pgEnum('matching_status', ['pending', 'matched', 'ignored']);
export const matchingPriorityEnum = pgEnum('matching_priority', ['normal', 'high']);

// 매칭 전략 enum 추가
export const matchingStrategyEnum = pgEnum('matching_strategy', ['void', 'variant']);

export const settingKeyEnum = pgEnum('setting_key', ['use_sub_barcode', 'use_expiry_separation']);
export const poTypeEnum = pgEnum('po_type', ['domestic', 'foreign']);
export const poStatusEnum = pgEnum('po_status', ['created', 'confirmed', 'received']);
export const poAuditStatusEnum = pgEnum('po_audit_status', [
  'draft', // 초안 - Not yet submitted
  'pending_audit', // 검토 대기 - Submitted for approval
  'approved', // 승인됨 - Approved
  'rejected', // 거부됨 - Rejected
]);
export const inboundStatusEnum = pgEnum('inbound_status', [
  'pending', // 입고 대기 - Initial state
  'applied', // 입고신청 - Applied for inbound
  'receiving', // 입고 중 - Currently receiving
  'confirmed', // 입고 완료 - Completed
]);
export const stockTypeEnum = pgEnum('stock_type', ['physical', 'infinite', 'drop_shipped', 'consignment']);

// 이중 입고 계획을 위한 새 enum
export const planTypeEnum = pgEnum('plan_type', ['source', 'destination']);

// Stocktaking status enum
export const stocktakingStatusEnum = pgEnum('stocktaking_status', [
  'draft', // 작성 중 - Being created
  'in_progress', // 진행 중 - Actively counting
  'completed', // 완료 - Counting finished
  'cancelled', // 취소 - Cancelled
]);

// Inbound domain enums
export const inboundMethodEnum = pgEnum('inbound_method', [
  'individual', // 개별입고
  'simple', // 간편입고
  'simple_fullscan', // 전수검사 간편입고
  'planned', // 입고예정검수 기반 실입고
]);
export const inboundReceiptStatusEnum = pgEnum('inbound_receipt_status', ['posted', 'voided']);
export const inboundWorkTypeEnum = pgEnum('inbound_work_type', ['INBOUND', 'PUTAWAY', 'RETURN', 'CANCEL']);

export const locationTypeEnum = pgEnum('location_type', ['standard', 'zone']);
// 시스템 로케이션 역할(enum)
export const systemLocationRoleEnum = pgEnum('system_location_role', [
  'inbound_default',
  'return_default',
  'outbound_rework',
]);

// 주문 관련 enum 추가
export const orderStatusEnum = pgEnum('order_status', [
  'pending', // 주문 생성 (결제 대기)
  'confirmed', // 주문 확정 (결제 완료)
  // DEAD 값(producer 0, 작업 15) — SO 출고/배송 진실은 FO(fulfillmentOrders.status + shippedAt)
  // 도출이 SoT 다(ADR-0017). SO.status 의 실 전이는 pending→confirmed→cancelled 뿐이다(timeout 도 현재 producer 0 인 예약 값).
  // 재사용 금지. 물리 제거(pgEnum recast)는 destructive·저가치라 비목표(구 8b 판례).
  'processing', // [DEAD] 미사용 — 도달 불가
  'shipped', // [DEAD] 미사용 — FO 도출로 대체
  'delivered', // [DEAD] 미사용 — FO 도출로 대체
  'cancelled', // 취소
  'timeout', // 타임아웃
]);

export const orderItemStatusEnum = pgEnum('order_item_status', [
  'pending', // 대기 중
  'matched', // 재고 매칭 완료
  'stock_deducted', // 재고 차감 완료
  'stock_unavailable', // 재고 부족
  'cancelled', // 취소
]);

export const salesChannelEnum = pgEnum('sales_channel', [
  'medusa', // 메두사 (자체 몰)
  'naver', // 네이버 스마트스토어
  'coupang', // 쿠팡
  '3pl', // 3PL
]);

export const eventTypeOrderEnum = pgEnum('event_type_order', [
  'ORDER_CREATED', // 주문 생성
  'ORDER_CONFIRMED', // 주문 확정
  'ORDER_MODIFIED', // 주문 수정
  'ORDER_CANCELLED', // 주문 취소
  'ORDER_REFUND_CREATED', // 환불 생성
]);

export const taskPriorityEnum = pgEnum('task_priority', ['normal', 'high', 'urgent']);
// Task 25 contract: V1 사장값 11개(reserving/unfulfillable/labeled/pending/allocated/picking/picked/
// inspecting/inspected/invoiced/forwarded) 제거. V2 progress calculator(fulfillment-progress.service)가
// 내는 8개 + drop_ship ship() 가 쓰는 'shipped' 만 남는다. (직배 상태는 별도 direct_ship_status enum)
export const fulfillmentStatusEnum = pgEnum('fulfillment_status', [
  'created',
  'partially_reserved',
  'ready',
  'processing',
  'shipped',
  'partially_shipped',
  'completed',
  'canceled',
  'recovery_required',
]);
export const fulfillmentModeEnum = pgEnum('fulfillment_mode', ['in_house', '3pl', 'drop_ship']);
export const fulfillmentOrderCreationBacklogStatusEnum = pgEnum('fulfillment_order_creation_backlog_status', [
  'pending',
  'processing',
  'awaiting_matching',
  'completed',
  'not_required',
  'failed',
]);
export const directShipStatusEnum = pgEnum('direct_ship_status', ['pending', 'forwarded', 'completed', 'canceled']);
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'published', 'failed']);

// FOI 기반 확장 enums
export const pickingMethodEnum = pgEnum('picking_method', ['individual', 'total_picking']);
export const pickingStrategyEnum = pgEnum('picking_strategy', ['discrete', 'aggregate_then_sort', 'pick_to_tote']);
export const batchStatusEnum = pgEnum('batch_status', ['created', 'picking', 'completed', 'canceled']);
// Outbound V2 expand enums. These are additive and intentionally coexist with V1 enums until Task 25.
export const fulfillmentCommandRequestStatusEnum = pgEnum('fulfillment_command_request_status', [
  'pending',
  'completed',
  'failed',
]);
export const shipmentOperationTypeEnum = pgEnum('shipment_operation_type', [
  'split',
  'consolidate',
  'recipient_revision',
  'cancel',
  'reopen',
  'plan',
  'replan',
  'short_pick',
  'recall',
]);
export const shipmentOperationStatusEnum = pgEnum('shipment_operation_status', [
  'pending',
  'completed',
  'failed',
  'recovery_required',
]);
export const shipmentOperationMemberRoleEnum = pgEnum('shipment_operation_member_role', ['source', 'target']);
export const outboundBatchWorkItemStatusEnum = pgEnum('outbound_batch_work_item_status', [
  'queued',
  'picking',
  'ready_to_pack',
  'packing',
  'completed',
  'short_pick_recovery',
  'excluded',
]);
export const pickingPlanStatusEnum = pgEnum('picking_plan_status', [
  'draft',
  'active',
  'invalidated',
  'completed',
  'canceled',
]);
export const batchInventorySessionStatusEnum = pgEnum('batch_inventory_session_status', [
  'active',
  'settled',
  'recovery_required',
  'canceled',
]);
export const batchInventoryCustodyTypeEnum = pgEnum('batch_inventory_custody_type', [
  'AT_SOURCE',
  'WORKER',
  'BULK_CART',
  'TOTE',
  'SORTING',
  'PACKING',
  'PACKED',
  'RETURN_PENDING',
  'SETTLED',
]);
export const toteStatusEnum = pgEnum('tote_status', ['available', 'in_use', 'damaged', 'retired']);
export const dispatchAttemptStatusEnum = pgEnum('dispatch_attempt_status', [
  'pending',
  'dispatched',
  'recalled',
  'recovery_required',
]);

// Audit system enums
export const auditEventTypeEnum = pgEnum('audit_event_type', [
  // 사용자 액션
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_ACTION',

  // 재고 관련
  'STOCK_CREATED',
  'STOCK_UPDATED',
  'STOCK_DELETED',
  'STOCK_RESERVED',
  'STOCK_UNRESERVED',
  'STOCK_MOVED',

  // 주문 관련
  'ORDER_CREATED',
  'ORDER_CONFIRMED',
  'ORDER_CANCELLED',
  'ORDER_MERGED',
  'FULFILLMENT_CREATED',
  'FULFILLMENT_READY',
  'FULFILLMENT_SHIPPED',

  // SKU/상품 관련
  'SKU_CREATED',
  'SKU_UPDATED',
  'SKU_DELETED',
  'PRODUCT_MATCHED',
  'PRODUCT_MATCHING_RESOLVED',

  // 시스템 이벤트
  'SYSTEM_STARTUP',
  'SYSTEM_ERROR',
  'SYSTEM_WARNING',

  // 설정 변경
  'CONFIG_CHANGED',
  'POLICY_CHANGED',
]);

export const auditSeverityEnum = pgEnum('audit_severity', ['INFO', 'WARN', 'ERROR', 'CRITICAL']);

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),

  // Contact information
  phone: varchar('phone', { length: 50 }),
  fax: varchar('fax', { length: 50 }),
  email: varchar('email', { length: 255 }),

  // Address information
  zipcode: varchar('zipcode', { length: 20 }),
  address1: varchar('address1', { length: 500 }),
  address2: varchar('address2', { length: 500 }),

  // Business information
  businessRegNo: varchar('business_reg_no', { length: 50 }),
  businessType: varchar('business_type', { length: 100 }),
  ceoName: varchar('ceo_name', { length: 100 }),

  // 사람이 식별하는 짧은 공급사 코드 (예: "LCN"). nullable.
  code: varchar('code', { length: 50 }),

  // Purchase settings
  isDirectDelivery: boolean('is_direct_delivery').notNull().default(false),
  orderCutoffTime: varchar('order_cutoff_time', { length: 10 }),

  // Payment information
  bankName: varchar('bank_name', { length: 100 }),
  bankAccountNo: varchar('bank_account_no', { length: 100 }),
  bankAccountHolder: varchar('bank_account_holder', { length: 100 }),
  // NOTE: Common values: 'prepaid', 'postpaid', 'monthly'. Kept as varchar for flexibility
  paymentMethod: varchar('payment_method', { length: 50 }),

  // Additional metadata
  description: text('description'),
  memo: text('memo'),

  // NOTE: References user-service users table (separate DB), stored as string without FK
  purchaseManagerId: varchar('purchase_manager_id', { length: 36 }),

  defaultWarehouseId: uuid('default_warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierCategories = pgTable('supplier_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const supplierCategoryMappings = pgTable(
  'supplier_category_mappings',
  {
    supplierId: uuid('supplier_id')
      .references(() => suppliers.id, { onDelete: 'cascade' })
      .notNull(),
    categoryId: uuid('category_id')
      .references(() => supplierCategories.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.supplierId, t.categoryId] }),
  }),
);

/*───────────────────────────
 * MOVEMENT JOBS (헤더/라인/타임라인)
 *──────────────────────────*/
export const movementJobs = pgTable(
  'movement_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    totalQuantity: integer('total_quantity').notNull().default(0),
    journalId: uuid('journal_id').references(() => stockJournals.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id'),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxMovementJobsWhTime: index('idx_movement_jobs_wh_time').on(t.warehouseId, t.occurredAt),
  }),
);

export const movementJobLines = pgTable(
  'movement_job_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    jobId: uuid('job_id')
      .references(() => movementJobs.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    fromLocationId: uuid('from_location_id').references(() => locations.id, { onDelete: 'set null' }),
    toLocationId: uuid('to_location_id').references(() => locations.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxMovementLinesJob: index('idx_movement_lines_job').on(t.jobId),
    idxMovementLinesSku: index('idx_movement_lines_sku').on(t.skuId),
  }),
);

export const movementWorkLogs = pgTable(
  'movement_work_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: varchar('type', { length: 32 }).notNull().default('MOVE'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    jobId: uuid('job_id').references(() => movementJobs.id, { onDelete: 'set null' }),
    lineId: uuid('line_id').references(() => movementJobLines.id, { onDelete: 'set null' }),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'set null' }),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    fromLocationId: uuid('from_location_id').references(() => locations.id, { onDelete: 'set null' }),
    toLocationId: uuid('to_location_id').references(() => locations.id, { onDelete: 'set null' }),
    quantity: integer('quantity'),
    eventId: uuid('event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
    reason: varchar('reason', { length: 255 }),
  },
  (t) => ({
    idxMovementWorkTime: index('idx_movement_work_time').on(t.timestamp),
  }),
);

export const holders = pgTable('holders', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  isOurAsset: boolean('is_our_asset').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skus = pgTable(
  'skus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    holderId: uuid('holder_id')
      .references(() => holders.id, { onDelete: 'cascade' })
      .default('019d0001-0000-7000-a000-000000000001')
      .notNull(),
    groupId: uuid('group_id').references(() => skuGroups.id, { onDelete: 'set null' }),
    optionKey: varchar('option_key', { length: 255 }),

    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 64 }).notNull().unique(),

    stockType: stockTypeEnum('stock_type').notNull().default('physical'),
    deliveryProfileId: uuid('delivery_profile_id').references(() => deliveryProfiles.id, { onDelete: 'set null' }),
    sale1m: integer('sale_1m'),
    sale3m: integer('sale_3m'),
    safetyStock: integer('safety_stock').notNull().default(0), // 안전 재고

    // ===== Extended Metadata Fields (Phase 2 - Step 4) =====

    // 기본 정보 확장
    businessProductName: varchar('business_product_name', { length: 255 }),
    importDeclarationNumber: varchar('import_declaration_number', { length: 100 }),
    logisticsPartnerId: uuid('logistics_partner_id').references(() => suppliers.id, { onDelete: 'set null' }),
    discount: varchar('discount', { length: 100 }),
    manufacturerStar: varchar('manufacturer_star', { length: 100 }),

    // 물리 속성
    productWeight: integer('product_weight'), // in grams
    dimensionWidth: integer('dimension_width'), // in cm
    dimensionHeight: integer('dimension_height'), // in cm
    dimensionDepth: integer('dimension_depth'), // in cm
    productMaterial: text('product_material'),

    // 추가 메타데이터
    koreanName: varchar('korean_name', { length: 255 }),
    maxDiscountQuantity: integer('max_discount_quantity'),
    packagingImporterName: varchar('packaging_importer_name', { length: 255 }),

    // 판매 정보
    productDescription: text('product_description'),
    moq: integer('moq'), // Minimum Order Quantity
    memo2: text('memo2'),
    memo3: text('memo3'),

    // 이미지 관리
    mainImageUrl: varchar('main_image_url', { length: 512 }), // @deprecated - Use skuImages table

    // 유효기간 및 날짜 관리
    expiryDateManagement: boolean('expiry_date_management').notNull().default(false),
    expiryStartDate: timestamp('expiry_start_date', { withTimezone: true }),
    expiryEndDate: timestamp('expiry_end_date', { withTimezone: true }),
    manufacturingDateManagement: boolean('manufacturing_date_management').notNull().default(false),
    isGeneralInventory: boolean('is_general_inventory').notNull().default(true),

    // 유효 기간
    validityStartDate: timestamp('validity_start_date', { withTimezone: true }),
    validityEndDate: timestamp('validity_end_date', { withTimezone: true }),

    // 로케이션 추적
    primaryLocationId: uuid('primary_location_id').references(() => locations.id, { onDelete: 'set null' }),
    secondaryLocationId: uuid('secondary_location_id').references(() => locations.id, { onDelete: 'set null' }),

    // 옵션 그룹
    variantGroupCode: varchar('variant_group_code', { length: 64 }),

    isDeleted: boolean('is_deleted').notNull().default(false),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 성능 최적화 인덱스
    idxSkusSafetyStock: index('idx_skus_safety_stock').on(t.safetyStock),
    idxSkusVariantGroup: index('idx_skus_variant_group').on(t.variantGroupCode),
    idxSkusPrimaryLocation: index('idx_skus_primary_location').on(t.primaryLocationId),
    idxSkusWeight: index('idx_skus_weight').on(t.productWeight),
    idxSkusMoq: index('idx_skus_moq').on(t.moq),
    idxSkusGroupId: index('idx_skus_group_id').on(t.groupId), // WMS-internal grouping
  }),
);

export const skuSuppliers = pgTable(
  'sku_suppliers',
  {
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),
    supplierId: uuid('supplier_id')
      .references(() => suppliers.id, { onDelete: 'cascade' })
      .notNull(),
    // 공급사가 자기 시스템에서 이 SKU를 식별하는 코드 (예: "SKU-001"). nullable.
    supplierSku: varchar('supplier_sku', { length: 100 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.skuId, t.supplierId),
  }),
);

export const skuBarcodes = pgTable('sku_barcodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id')
    .references(() => skus.id, { onDelete: 'cascade' })
    .notNull(),
  barcode: varchar('barcode', { length: 64 }).notNull().unique(),
  isPrimary: boolean('is_primary').notNull().default(false),
  packingUnit: varchar('packing_unit', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skuImages = pgTable(
  'sku_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'cascade' }),

    uploadId: uuid('upload_id').notNull(),

    isPrimary: boolean('is_primary').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSkuImagesSkuId: index('idx_sku_images_sku_id').on(t.skuId),
    idxSkuImagesPrimary: index('idx_sku_images_primary').on(t.skuId, t.isPrimary),
    idxSkuImagesSort: index('idx_sku_images_sort').on(t.skuId, t.sortOrder),
  }),
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const skuCategories = pgTable('sku_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id')
    .references(() => skus.id, { onDelete: 'cascade' })
    .notNull(),
  categoryId: uuid('category_id')
    .references(() => categories.id, { onDelete: 'cascade' })
    .notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ===== Phase 2 Step 4: New SKU Related Tables =====

// SKU Managers: SKU별 담당자 관리
export const skuManagers = pgTable(
  'sku_managers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),

    // 담당자 역할 (모두 nullable - 모든 SKU에 담당자가 필요한 것은 아님)
    designerId: uuid('designer_id'), // 상품디자이너
    purchaseManagerId: uuid('purchase_manager_id'), // 발주담당자
    registrationManagerId: uuid('registration_manager_id'), // 상품등록자

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueSkuManager: unique().on(t.skuId),
  }),
);

// SKU Location Movements: SKU 위치 이동 추적
export const skuLocationMovements = pgTable(
  'sku_location_movements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),

    barcode: varchar('barcode', { length: 64 }).notNull(),

    // 위치 추적
    fromLocationId: uuid('from_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),
    toLocationId: uuid('to_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),

    // 이동 상세
    quantity: integer('quantity'), // Nullable for full SKU moves
    reason: text('reason'),
    status: varchar('status', { length: 20 }).notNull().default('completed'),

    // 감사
    movedBy: uuid('moved_by'),
    movementTimestamp: timestamp('movement_timestamp', { withTimezone: true }).notNull().defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxMovementSku: index('idx_movement_sku').on(t.skuId),
    idxMovementBarcode: index('idx_movement_barcode').on(t.barcode),
    idxMovementTimestamp: index('idx_movement_timestamp').on(t.movementTimestamp),
  }),
);

// ===== SKU GROUPS (WMS-internal warehouse organization) =====
// Groups are metadata labels for organizing similar SKUs (e.g., color/size variants)
// Key design: Groups do NOT cascade delete - SKUs survive when group is deleted (ON DELETE SET NULL)
export const skuGroups = pgTable(
  'sku_groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Basic info
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 100 }).notNull().unique(),
    description: text('description'),

    // Metadata
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSkuGroupsCode: index('idx_sku_groups_code').on(t.code),
    idxSkuGroupsName: index('idx_sku_groups_name').on(t.name),
  }),
);

export const deliveryProfiles = pgTable('delivery_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  sourceType: sourceTypeEnum('source_type').notNull(),
  avgDeliveryDays: integer('avg_delivery_days'),
  // TODO(outbound-v2-contract Task 25): require execution snapshots/modes for profiles used by planned shipments.
  senderSnapshot: jsonb('sender_snapshot'),
  originAddressSnapshot: jsonb('origin_address_snapshot'),
  returnAddressSnapshot: jsonb('return_address_snapshot'),
  carrierAccountRef: varchar('carrier_account_ref', { length: 255 }),
  supportedFulfillmentModes: fulfillmentModeEnum('supported_fulfillment_modes').array(),
  handlingFlags: jsonb('handling_flags'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// warehouses 테이블에 type 필드 추가
export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  type: warehouseTypeEnum('type').notNull().default('domestic'), // 창고 타입 추가
  location: varchar('location', { length: 256 }),
  // TODO(outbound-v2-contract Task 25): require explicit configuration; null means V2 planning must reject.
  supportedPickingStrategies: pickingStrategyEnum('supported_picking_strategies').array(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * LOCATION
 *──────────────────────────*/
export const locationColumns = pgTable(
  'location_columns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    columnName: varchar('column_name', { length: 10 }).notNull(),
    displayOrder: integer('display_order'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqWarehouseColumn: unique().on(t.warehouseId, t.columnName),
    idxColumnsWarehouseName: index('idx_columns_warehouse_name').on(t.warehouseId, t.columnName),
  }),
);

export const locationRacks = pgTable(
  'location_racks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    columnId: uuid('column_id')
      .references(() => locationColumns.id, { onDelete: 'cascade' })
      .notNull(),
    rackNumber: integer('rack_number').notNull(),
    defaultBinStart: integer('default_bin_start').notNull().default(1),
    defaultBinEnd: integer('default_bin_end').notNull().default(20),
    autoGenerateBins: boolean('auto_generate_bins').notNull().default(true),
    physicalWidth: integer('physical_width'),
    physicalHeight: integer('physical_height'),
    notes: text('notes'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqColumnRack: unique().on(t.columnId, t.rackNumber),
    idxRacksColumnNumber: index('idx_racks_column_number').on(t.columnId, t.rackNumber),
  }),
);

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    locationType: locationTypeEnum('location_type').notNull(),
    rackId: uuid('rack_id').references(() => locationRacks.id, { onDelete: 'cascade' }),
    binIdentifier: varchar('bin_identifier', { length: 20 }),
    displayName: varchar('display_name', { length: 128 }),
    capacityLimit: integer('capacity_limit'),
    fifoRank: integer('fifo_rank'),
    isExpirySeparated: boolean('is_expiry_separated').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    // 시스템 로케이션 보호 필드
    isSystem: boolean('is_system').notNull().default(false),
    systemRole: systemLocationRoleEnum('system_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqWarehouseCode: unique().on(t.warehouseId, t.code),
    uqWarehouseSystemRole: unique().on(t.warehouseId, t.systemRole),
    ckLocationsType: check(
      'ck_locations_type',
      sql`(
        (location_type = 'standard' AND rack_id IS NOT NULL AND bin_identifier IS NOT NULL)
        OR 
        (location_type = 'zone' AND rack_id IS NULL AND bin_identifier IS NULL)
    )`,
    ),
    ckLocationsSystemRole: check(
      'ck_locations_system_role',
      sql`( (is_system = true AND system_role IS NOT NULL) OR (is_system = false AND system_role IS NULL) )`,
    ),
    ckLocationsSystemZone: check('ck_locations_system_zone', sql`( is_system = false OR location_type = 'zone' )`),
    locationsWarehouseType: index('idx_locations_warehouse_type').on(t.warehouseId, t.locationType),
    locationsRackBin: index('idx_locations_rack_bin').on(t.rackId, t.binIdentifier),
  }),
);

// indexes moved into table definitions above

/*───────────────────────────
 * REQUEST IDEMPOTENCY (P2-4)
 * 입고/이동 요청 전체의 멱등 기록. 이벤트 레벨 stock_events.idempotency_key 와 별개의
 * 요청(핸들러) 레벨 방어 — 스펙 docs/superpowers/specs/2026-07-09-inbound-movement-idempotency-design.md §4.1
 *──────────────────────────*/
export const inventoryIdempotencyRequests = pgTable(
  'inventory_idempotency_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpoint: varchar('endpoint', { length: 64 }).notNull(),
    key: varchar('key', { length: 128 }).notNull(),
    // SHA-256(JSON.stringify(dto)) hex — 키 오용(같은 키, 다른 본문) 감지
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    // null = 처리 중(커밋 전에는 외부 미관찰). 완료 시 핸들러 반환값 저장
    response: jsonb('response'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqEndpointKey: uniqueIndex('uq_inv_idem_requests_endpoint_key').on(t.endpoint, t.key),
    idxCreatedAt: index('idx_inv_idem_requests_created_at').on(t.createdAt),
  }),
);

/*───────────────────────────
 * STOCK LEDGER
 *──────────────────────────*/
export const stockJournals = pgTable('stock_journals', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: varchar('source_type', { length: 64 }),
  sourceId: uuid('source_id'),
  idempotencyKey: varchar('idempotency_key', { length: 128 }).unique(),
  actorId: uuid('actor_id'),
});

export const stockEvents = pgTable(
  'stock_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    journalId: uuid('journal_id').references(() => stockJournals.id),

    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id),

    fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id),
    fromLocationId: uuid('from_location_id').references(() => locations.id, { onDelete: 'set null' }),
    toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id),
    toLocationId: uuid('to_location_id').references(() => locations.id, { onDelete: 'set null' }),

    fromState: stockStateEnum('from_state'),
    toState: stockStateEnum('to_state'),
    transitionType: transitionTypeEnum('transition_type').notNull(),

    quantity: integer('quantity').notNull(), // 항상 양수

    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),

    idempotencyKey: varchar('idempotency_key', { length: 128 }).unique(),
    eventStatus: eventStatusEnum('event_status').notNull().default('POSTED'),
    reversalOfEventId: uuid('reversal_of_event_id'),
    voidedByEventId: uuid('voided_by_event_id'),
    reason: varchar('reason', { length: 255 }),
  },
  (t) => ({
    ixGrainTime: index('ix_stock_events_grain_time').on(t.skuId, t.fromWarehouseId, t.toWarehouseId, t.occurredAt),
    uqReversalOfEvent: uniqueIndex('uq_stock_events_reversal_of_event')
      .on(t.reversalOfEventId)
      .where(sql`${t.reversalOfEventId} IS NOT NULL`),
    ckQtyPositive: check('ck_events_qty_positive', sql`${t.quantity} > 0`),
    ckStatesDifferent: check(
      'ck_events_states_diff',
      sql`(${t.fromState} is distinct from ${t.toState}) 
          OR (${t.fromLocationId} is distinct from ${t.toLocationId})
          OR (${t.fromWarehouseId} is distinct from ${t.toWarehouseId})`,
    ),
    ckSidePresent: check('ck_events_side_present', sql`(${t.fromState} is not null) or (${t.toState} is not null)`),
    ckFromLocNeedsWh: check(
      'ck_events_fromloc_has_wh',
      sql`(${t.fromLocationId} is null) or (${t.fromWarehouseId} is not null)`,
    ),
    ckToLocNeedsWh: check(
      'ck_events_toloc_has_wh',
      sql`(${t.toLocationId} is null) or (${t.toWarehouseId} is not null)`,
    ),
  }),
);

export const stockLedgers = pgTable(
  'stock_ledgers',
  {
    skuId: uuid('sku_id')
      .notNull()
      .references(() => skus.id, { onDelete: 'restrict' }),
    warehouseId: uuid('warehouse_id')
      .notNull()
      .references(() => warehouses.id),
    locationId: uuid('location_id')
      .notNull()
      .references(() => locations.id),
    stockState: stockStateEnum('stock_state').notNull(),
    qty: integer('qty').notNull().default(0),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skuId, t.warehouseId, t.locationId, t.stockState] }),
    ckNonNegative: check('ck_ledgers_non_negative', sql`${t.qty} >= 0`),
    ckVersionPositive: check('ck_stock_ledgers_version_positive', sql`${t.version} > 0`),
    ixLookup: index('ix_ledgers_lookup').on(t.skuId, t.warehouseId, t.locationId, t.stockState),
  }),
);

// 재고 현황 테이블
// stockSummary를 VIEW로 전환 - 실시간 집계를 위한 PostgreSQL VIEW
export const stockSummary = pgView('stock_summary_view', {
  skuId: uuid('sku_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  skuName: varchar('sku_name', { length: 255 }),
  warehouseName: varchar('warehouse_name', { length: 255 }),

  // 물리적 재고
  onHandQty: integer('on_hand_qty').notNull().default(0),
  defectiveQty: integer('defective_qty').notNull().default(0),
  inTransferQty: integer('in_transfer_qty').notNull().default(0),

  // 예약 상태
  reservedQty: integer('reserved_qty').notNull().default(0),
  availableQty: integer('available_qty').notNull().default(0),

  // 예정 상태
  inboundPendingQty: integer('inbound_pending_qty').notNull().default(0),
  onOrderQty: integer('on_order_qty').notNull().default(0),
  transferPendingQty: integer('transfer_pending_qty').notNull().default(0),

  // 계산된 전망
  projectedAvailableQty: integer('projected_available_qty').notNull().default(0),

  lastCalculatedAt: timestamp('last_calculated_at', { withTimezone: true }).notNull(),
}).as(sql`
    SELECT
        s.id as sku_id,
        w.id as warehouse_id,
        s.name as sku_name,
        w.name as warehouse_name,

        -- 물리적 재고
        COALESCE(on_hand.qty, 0) as on_hand_qty,
        COALESCE(defective.qty, 0) as defective_qty,
        COALESCE(in_transfer.qty, 0) as in_transfer_qty,

        -- 예약 상태
        COALESCE(reserved.qty, 0) as reserved_qty,
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) - COALESCE(transit_out.qty, 0) as available_qty,

        -- 예정 상태
        COALESCE(inbound_pending.qty, 0) as inbound_pending_qty,
        0 as on_order_qty,
        COALESCE(transit_out.qty, 0) as transfer_pending_qty,

        -- 계산된 전망
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) + COALESCE(inbound_pending.qty, 0) as projected_available_qty,

        NOW() as last_calculated_at

    FROM skus s
    CROSS JOIN warehouses w
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'ON_HAND'
        GROUP BY sku_id, warehouse_id
    ) on_hand ON s.id = on_hand.sku_id AND w.id = on_hand.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'DEFECTIVE'
        GROUP BY sku_id, warehouse_id
    ) defective ON s.id = defective.sku_id AND w.id = defective.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(qty) as qty
        FROM stock_ledgers
        WHERE stock_state = 'IN_TRANSFER'
        GROUP BY sku_id, warehouse_id
    ) in_transfer ON s.id = in_transfer.sku_id AND w.id = in_transfer.warehouse_id
    LEFT JOIN (
        SELECT sku_id, warehouse_id, SUM(quantity) as qty
        FROM stock_reservations
        WHERE status = 'confirmed'
        GROUP BY sku_id, warehouse_id
    ) reserved ON s.id = reserved.sku_id AND w.id = reserved.warehouse_id
    LEFT JOIN (
        SELECT ipi.sku_id, ip.destination_warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
        FROM inbound_plan_items ipi
        INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
        WHERE ipi.status = 'pending'
        GROUP BY ipi.sku_id, ip.destination_warehouse_id
    ) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.destination_warehouse_id
    LEFT JOIN (
        SELECT ipi.sku_id, ip.warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
        FROM inbound_plan_items ipi
        INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
        WHERE ipi.status = 'pending' AND ip.requires_transfer = true AND ip.warehouse_id != ip.destination_warehouse_id
        GROUP BY ipi.sku_id, ip.warehouse_id
    ) transit_out ON s.id = transit_out.sku_id AND w.id = transit_out.warehouse_id
`);

/*───────────────────────────
 * PRODUCT / VARIANT / SKU MAPPING
 *──────────────────────────*/
export const productMatchings = pgTable(
  'product_matchings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    masterId: uuid('master_id'), // PIM의 Master ID
    skuGroupId: uuid('sku_group_id').references(() => skuGroups.id, { onDelete: 'set null' }),
    status: matchingStatusEnum('status').notNull().default('pending'), // 매칭 상태 (pending, matched, ignored)
    priority: matchingPriorityEnum('priority').notNull().default('normal'), // 매칭 우선순위
    strategy: matchingStrategyEnum('strategy'), // 매칭 전략 (void, variant, option)
    isResolved: boolean('is_resolved').notNull().default(false), // 매칭이 해결되었는지
    // 재고 정책 필드들 (skus에서 이동)
    preStockSellable: boolean('pre_stock_sellable').notNull().default(true), // 재고 0이어도 선판매 가능한지 여부 (default true로 변경)
    alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false), // 재고 0이어도 항상 판매 가능한 상품 (직배/신상품)

    // isGift 제거 (사은품 속성은 판매주문 라인 등 상위로 이동)

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueVariantId: unique().on(t.variantId), // variant당 하나의 매칭만 존재
    idxMasterId: index('idx_product_matchings_master_id').on(t.masterId),
  }),
);

// product_variant_sku_links: variant와 sku의 N:M 관계를 위한 연결 테이블
export const productVariantSkuLinks = pgTable(
  'product_variant_sku_links',
  {
    productMatchingId: uuid('product_matching_id')
      .references(() => productMatchings.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'cascade' })
      .notNull(),
    quantity: integer('quantity').notNull().default(1), // 구성 수량 (세트 상품용)
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.productMatchingId, t.skuId),
  }),
);

export const productSellableQuantityProjections = pgTable(
  'product_sellable_quantity_projections',
  {
    variantId: uuid('variant_id').primaryKey(),
    masterId: uuid('master_id'),
    versionId: uuid('version_id'),
    matchingId: uuid('matching_id'),
    sellableQuantity: integer('sellable_quantity').notNull().default(0),
    stockBoundQuantity: integer('stock_bound_quantity').notNull().default(0),
    isSellable: boolean('is_sellable').notNull().default(false),
    reason: varchar('reason', { length: 64 }).notNull(),
    calculatedAt: timestamp('calculated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSellable: index('idx_product_sellable_qty_sellable').on(t.isSellable),
    idxUpdatedAt: index('idx_product_sellable_qty_updated_at').on(t.updatedAt),
  }),
);

/*───────────────────────────
 * ORDER MANAGEMENT
 *──────────────────────────*/
// 주문 테이블 추가
export const salesOrders = pgTable(
  'sales_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelOrderId: varchar('channel_order_id', { length: 255 }).notNull(), // 채널별 주문 ID
    salesChannel: salesChannelEnum('sales_channel').notNull(),
    status: orderStatusEnum('status').notNull().default('pending'),

    // 고객 정보
    // customerId: storefront 계정의 user id (JWT sub). 비-로그인 채널 (Naver, Coupang)은 NULL.
    // 디지털 ownership grant 및 본인 ownership 조회의 키.
    customerId: uuid('customer_id'),
    customerName: varchar('customer_name', { length: 255 }),
    customerEmail: varchar('customer_email', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 50 }),

    // 배송 정보
    shippingAddress: json('shipping_address').notNull(), // 배송지 전체 정보
    shippingAddressHash: varchar('shipping_address_hash', { length: 64 }), // 합배송 처리용 해시

    // 금액 정보
    totalAmount: integer('total_amount'), // 총 주문 금액
    shippingFee: integer('shipping_fee').notNull().default(0), // 배송비

    // 합배송 정보
    mergeGroupId: varchar('merge_group_id', { length: 64 }), // 합배송 그룹 ID
    isMerged: boolean('is_merged').notNull().default(false), // 합배송 여부

    // 메모
    memo: text('memo'), // 메모

    // 결제 연동
    // Wallet 서비스의 payment intent ID. Medusa 채널 주문의 경우 결제 세션 생성 시 설정.
    // 취소 시 자동 환불 workflow에서 사용. 비-Medusa 채널 또는 레거시 주문은 NULL.
    walletIntentId: varchar('wallet_intent_id', { length: 255 }),

    // 타임스탬프
    orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueChannelOrder: unique().on(t.salesChannel, t.channelOrderId), // 채널별 주문 ID 유니크
  }),
);

// 주문 상품 테이블 추가
export const salesOrderLines = pgTable(
  'sales_order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
      .references(() => salesOrders.id, { onDelete: 'cascade' })
      .notNull(),
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    productMatchingId: uuid('product_matching_id').references(() => productMatchings.id, { onDelete: 'set null' }), // 매칭 정보
    mappingSnapshotId: uuid('mapping_snapshot_id').references(() => productSkuMappingSnapshots.id, {
      onDelete: 'restrict',
    }), // SO 확정 시점 스냅샷

    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price'), // 단가
    totalPrice: integer('total_price'), // 총 가격

    // 이행 의도(물리/디지털). 디지털 라인은 물리 출고(FO) 대상에서 제외된다.
    // nullable — 미지정(기존 데이터/외부 채널)은 물리로 간주.
    fulfillmentKind: varchar('fulfillment_kind', { length: 16 }), // 'physical' | 'digital' | null
    requiresShipping: boolean('requires_shipping'), // null = 물리로 간주

    // TODO(outbound-v2-contract Task 25): trusted post-cutover channel orders require channelOrderItemId.
    channelOrderItemId: varchar('channel_order_item_id', { length: 255 }),
    channelProductId: varchar('channel_product_id', { length: 255 }),

    status: orderItemStatusEnum('status').notNull().default('pending'),
    suggestedQuantity: integer('suggested_quantity'), // 부분 수량 제안
    unavailableSkuIds: json('unavailable_sku_ids'), // 부족한 SKU 정보

    deductedAt: timestamp('deducted_at', { withTimezone: true }), // 재고 차감 시간

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxMappingSnapshot: index('idx_sales_order_lines_snapshot').on(t.mappingSnapshotId),
    idxVariant: index('idx_sales_order_lines_variant').on(t.variantId),
    idxChannelOrderItem: index('idx_sales_order_lines_channel_order_item').on(t.channelOrderItemId),
    idxChannelProduct: index('idx_sales_order_lines_channel_product').on(t.channelProductId),
    uqSalesOrderChannelItem: uniqueIndex('uq_sales_order_lines_order_channel_item')
      .on(t.salesOrderId, t.channelOrderItemId)
      .where(sql`${t.channelOrderItemId} IS NOT NULL`),
  }),
);

// 주문 이벤트 로그 테이블 추가
export const orderEvents = pgTable('order_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: varchar('event_id', { length: 255 }).notNull().unique(), // 멱등성 체크용
  orderId: uuid('order_id')
    .references(() => salesOrders.id, { onDelete: 'cascade' })
    .notNull(),
  eventType: eventTypeOrderEnum('event_type').notNull(),
  payload: json('payload').notNull(), // 이벤트 데이터
  processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const businessLinks = pgTable(
  'business_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceType: varchar('source_type', { length: 64 }).notNull(),
    sourceId: uuid('source_id'),
    sourceExternalRef: varchar('source_external_ref', { length: 255 }),
    targetType: varchar('target_type', { length: 64 }).notNull(),
    targetId: uuid('target_id'),
    targetExternalRef: varchar('target_external_ref', { length: 255 }),
    relationName: varchar('relation_name', { length: 96 }).notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSourceId: index('idx_business_links_source_id').on(t.sourceType, t.sourceId),
    idxSourceExternalRef: index('idx_business_links_source_external_ref').on(t.sourceType, t.sourceExternalRef),
    idxTargetId: index('idx_business_links_target_id').on(t.targetType, t.targetId),
    idxTargetExternalRef: index('idx_business_links_target_external_ref').on(t.targetType, t.targetExternalRef),
    idxRelationName: index('idx_business_links_relation_name').on(t.relationName),
    idxOccurredAt: index('idx_business_links_occurred_at').on(t.occurredAt),
    sourceReferenceRequired: check(
      'business_links_source_ref_required',
      sql`${t.sourceId} IS NOT NULL OR ${t.sourceExternalRef} IS NOT NULL`,
    ),
    targetReferenceRequired: check(
      'business_links_target_ref_required',
      sql`${t.targetId} IS NOT NULL OR ${t.targetExternalRef} IS NOT NULL`,
    ),
  }),
);

export const salesOrderAmendments = pgTable(
  'sales_order_amendments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
      .references(() => salesOrders.id, { onDelete: 'cascade' })
      .notNull(),
    amendmentKind: varchar('amendment_kind', { length: 32 }).$type<'commercial' | 'fulfillment_only'>().notNull(),
    decision: varchar('decision', { length: 32 }).notNull().default('approved'),
    reasonCode: varchar('reason_code', { length: 96 }),
    note: text('note'),
    deltas: jsonb('deltas').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSalesOrderId: index('idx_sales_order_amendments_sales_order_id').on(t.salesOrderId),
    idxAmendmentKind: index('idx_sales_order_amendments_kind').on(t.amendmentKind),
    idxOccurredAt: index('idx_sales_order_amendments_occurred_at').on(t.occurredAt),
    amendmentKindCheck: check(
      'sales_order_amendments_kind_check',
      sql`${t.amendmentKind} IN ('commercial', 'fulfillment_only')`,
    ),
    decisionCheck: check(
      'sales_order_amendments_decision_check',
      sql`${t.decision} IN ('approved', 'rejected', 'pending')`,
    ),
    deltasArrayCheck: check('sales_order_amendments_deltas_array_check', sql`jsonb_typeof(${t.deltas}) = 'array'`),
  }),
);

export const salesOrderCancellations = pgTable(
  'sales_order_cancellations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
      .references(() => salesOrders.id, { onDelete: 'cascade' })
      .notNull(),
    cancellationScope: varchar('cancellation_scope', { length: 32 })
      .$type<'full' | 'partial'>()
      .notNull()
      .default('full'),
    status: varchar('status', { length: 32 }).$type<'applied'>().notNull().default('applied'),
    reasonCode: varchar('reason_code', { length: 96 }),
    reasonDetail: text('reason_detail'),
    cancelledBy: varchar('cancelled_by', { length: 128 }),
    effects: jsonb('effects')
      .notNull()
      .default(sql`'[]'::jsonb`),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxSalesOrderId: index('idx_sales_order_cancellations_sales_order_id').on(t.salesOrderId),
    idxScope: index('idx_sales_order_cancellations_scope').on(t.cancellationScope),
    idxOccurredAt: index('idx_sales_order_cancellations_occurred_at').on(t.occurredAt),
    uniqueFullCancellation: uniqueIndex('uniq_sales_order_full_cancellation')
      .on(t.salesOrderId)
      .where(sql`${t.cancellationScope} = 'full'`),
    cancellationScopeCheck: check(
      'sales_order_cancellations_scope_check',
      sql`${t.cancellationScope} IN ('full', 'partial')`,
    ),
    statusCheck: check('sales_order_cancellations_status_check', sql`${t.status} IN ('applied')`),
    effectsArrayCheck: check(
      'sales_order_cancellations_effects_array_check',
      sql`jsonb_typeof(${t.effects}) = 'array'`,
    ),
  }),
);

// 합배송 그룹 테이블 추가
export const mergeGroups = pgTable('merge_groups', {
  id: varchar('id', { length: 64 }).primaryKey(), // G-{sequence} 형태
  customerEmail: varchar('customer_email', { length: 255 }).notNull(),
  shippingAddressHash: varchar('shipping_address_hash', { length: 64 }).notNull(),
  totalShippingFee: integer('total_shipping_fee').notNull().default(0),
  orderCount: integer('order_count').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Fulfillment Orders (FO)
export const fulfillmentOrders = pgTable(
  'fulfillment_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'cascade' }),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    ownerId: uuid('owner_id').references(() => holders.id, { onDelete: 'set null' }),
    status: fulfillmentStatusEnum('status').notNull().default('created'),
    directShipStatus: directShipStatusEnum('direct_ship_status'),

    // 출고 관련 필드들 (batchId 는 Task 25 contract 에서 제거 — FO↔batch 링크 은퇴, batch 단위는 shipment)
    fulfillmentMode: fulfillmentModeEnum('fulfillment_mode'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),

    // 수량 관련 필드들
    totalItems: integer('total_items').notNull().default(0),
    totalQty: integer('total_qty').notNull().default(0),
    totalReservedQty: integer('total_reserved_qty').notNull().default(0),
    reservationFailureReason: text('reservation_failure_reason'),
    reservationFailureDetails: jsonb('reservation_failure_details'),

    // 타임스탬프 필드들
    allocatedAt: timestamp('allocated_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),

    shippingAddress: json('shipping_address'),

    // TODO: 송화인(발송인) 정보 추가 필요
    // - 주문 출고 시 salesOrder.channelId로 PIM의 channel 조회
    // - channel.config.sender가 있으면 senderAddress로 사용
    // - sender 구조: { name, phone, zipcode, address, detailAddress }
    // 예: senderAddress: json('sender_address'),

    labelNo: varchar('label_no', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // SO:FO 0..1:0..1 강제. standalone/보상 FO(salesOrderId=null)는 자연 제외.
    uqSalesOrder: uniqueIndex('uq_fulfillment_orders_sales_order')
      .on(t.salesOrderId)
      .where(sql`${t.salesOrderId} IS NOT NULL`),
  }),
);

export const fulfillmentOrderCreationBacklogs = pgTable(
  'fulfillment_order_creation_backlogs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
      .references(() => salesOrders.id, { onDelete: 'cascade' })
      .notNull(),
    fulfillmentOrderId: uuid('fulfillment_order_id').references(() => fulfillmentOrders.id, { onDelete: 'set null' }),
    status: fulfillmentOrderCreationBacklogStatusEnum('status').notNull().default('pending'),
    waitingVariantIds: jsonb('waiting_variant_ids')
      .notNull()
      .default(sql`'[]'::jsonb`),
    failureReason: varchar('failure_reason', { length: 128 }),
    failureDetails: jsonb('failure_details'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueSalesOrder: unique().on(t.salesOrderId),
    idxStatusNextAttempt: index('idx_fo_creation_backlogs_status_next_attempt').on(t.status, t.nextAttemptAt),
    idxFulfillmentOrder: index('idx_fo_creation_backlogs_fulfillment_order').on(t.fulfillmentOrderId),
    idxWaitingVariantIds: index('idx_fo_creation_backlogs_waiting_variant_ids').using('gin', t.waitingVariantIds),
  }),
);

/*───────────────────────────
 * RESERVATIONS
 *──────────────────────────*/
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 통합 예약 대상 정보
    targetType: varchar('target_type', { length: 50 }).notNull(), // 'FULFILLMENT_ORDER' 만 사용 (구 이동작업 예약 타입 제거)
    targetId: uuid('target_id').notNull(), // FO ID

    // 기존 FO 호환성을 위해 유지 (nullable로 변경)
    fulfillmentOrderItemId: uuid('fulfillment_order_item_id').references(() => fulfillmentOrderItems.id, {
      onDelete: 'cascade',
    }),
    // Task 25 contract: legacy FO-target 예약 제거 후 shipment-line 예약만 남아 NOT NULL 강제.
    shipmentLineId: uuid('shipment_line_id')
      .references(() => shipmentLines.id, { onDelete: 'restrict' })
      .notNull(),

    // 예약 기본 정보
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    status: reservationStatusEnum('status').notNull().default('pending'),

    // 예약 메타 정보
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    reason: text('reason'), // 예약 사유
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    stateReason: varchar('state_reason', { length: 128 }),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 인덱스 추가
    targetIdx: index('stock_reservations_target_idx').on(t.targetType, t.targetId),
    skuWarehouseIdx: index('stock_reservations_sku_warehouse_idx').on(t.skuId, t.warehouseId),
    statusIdx: index('stock_reservations_status_idx').on(t.status),
    shipmentLineIdx: index('idx_stock_reservations_shipment_line').on(t.shipmentLineId),
    requestedAtIdx: index('idx_stock_reservations_requested_at').on(t.requestedAt),
    ckReservationQuantityPositive: check('ck_stock_reservations_quantity_positive', sql`${t.quantity} > 0`),
    ckReservationInvalidation: check(
      'ck_stock_reservations_invalidation',
      sql`${t.invalidatedAt} IS NULL OR ${t.stateReason} IS NOT NULL`,
    ),
  }),
);

/*───────────────────────────
 * SHIPMENTS
 *──────────────────────────*/
export const shipments = pgTable(
  'shipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 박스 = 송장 한 장. V2 shipment 은 planning 단계에서 'draft' 로 생성 (V1 lazy open-box·'open' 상태 은퇴, Task 25).
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    // 자동완료 판정 기준 FO. FO↔상자 M:N 허용(B 에서 shipments unique drop). nullable: 합배송에서 미설정.
    openedForFulfillmentOrderId: uuid('opened_for_fulfillment_order_id').references(() => fulfillmentOrders.id, {
      onDelete: 'set null',
    }),
    status: shipmentStatusEnum('status').notNull().default('draft'),
    // TODO(outbound-v2-contract Task 25): require profile/recipient for planned V2 shipments.
    shippingProfileId: uuid('shipping_profile_id').references(() => deliveryProfiles.id, { onDelete: 'restrict' }),
    recipientSnapshot: jsonb('recipient_snapshot'),
    manifestVersion: integer('manifest_version').notNull().default(1),
    reservationVersion: integer('reservation_version').notNull().default(1),
    openedBy: uuid('opened_by'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    plannedAt: timestamp('planned_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    recoveryCode: varchar('recovery_code', { length: 128 }),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 전수(취소 포함) FO 조회용.
    idxOpenedForFo: index('idx_shipments_opened_for_fo').on(t.openedForFulfillmentOrderId),
    idxShippingProfile: index('idx_shipments_shipping_profile').on(t.shippingProfileId),
    idxWarehouseStatus: index('idx_shipments_warehouse_status').on(t.warehouseId, t.status),
    ckManifestVersionPositive: check('ck_shipments_manifest_version_positive', sql`${t.manifestVersion} > 0`),
    ckReservationVersionPositive: check('ck_shipments_reservation_version_positive', sql`${t.reservationVersion} > 0`),
    ckShipmentRecoveryCode: check(
      'ck_shipments_recovery_code',
      sql`${t.status}::text <> 'recovery_required' OR ${t.recoveryCode} IS NOT NULL`,
    ),
    ckShipmentSupersededAt: check(
      'ck_shipments_superseded_at',
      sql`${t.status}::text <> 'superseded' OR ${t.supersededAt} IS NOT NULL`,
    ),
  }),
);

/**
 * 상자 라인(shipment_line) — 한 상자에 담긴 출고 라인 (Phase 1, additive).
 * source 출고주문 라인(FOI)을 참조한다. 현재는 FO 1:1 이라 상자당 그 FO 의 FOI 를 미러하지만,
 * 모델 자체는 FO↔상자 M:N(송장분할·합배송)을 표현할 수 있다(흐름 구현은 후속).
 * `consumeShipment(shipmentId)` 가 라인별로 FIFO 차감 + 예약 소진의 단위로 쓴다.
 */
export const shipmentLines = pgTable(
  'shipment_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'cascade' })
      .notNull(),
    fulfillmentOrderItemId: uuid('fulfillment_order_item_id')
      .references(() => fulfillmentOrderItems.id, { onDelete: 'restrict' })
      .notNull(),
    // 원장 차감용 denormalize (FOI 의 skuId 와 동일). 라인만으로 SHIP 이벤트를 만들 수 있게.
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    qty: integer('qty').notNull(),
    reservedQty: integer('reserved_qty').notNull().default(0),
    inspectedQty: integer('inspected_qty').notNull().default(0),
    lineVersion: integer('line_version').notNull().default(1),
    createdFromLineId: uuid('created_from_line_id').references((): AnyPgColumn => shipmentLines.id, {
      onDelete: 'set null',
    }),
    forced: boolean('forced').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxShipment: index('idx_shipment_lines_shipment').on(t.shipmentId),
    // 상자당 FOI 1행 — 멱등 ensure(onConflictDoNothing)의 근거. M:N end-state 에서도 성립.
    uqShipmentFoi: unique('uq_shipment_lines_shipment_foi').on(t.shipmentId, t.fulfillmentOrderItemId),
    ckQtyPositive: check('ck_shipment_lines_qty_positive', sql`${t.qty} > 0`),
    ckInspectedRange: check(
      'ck_shipment_lines_inspected_range',
      sql`${t.inspectedQty} >= 0 AND ${t.inspectedQty} <= ${t.qty}`,
    ),
    ckReservedRange: check(
      'ck_shipment_lines_reserved_range',
      sql`${t.reservedQty} >= 0 AND ${t.reservedQty} <= ${t.qty}`,
    ),
    ckLineVersionPositive: check('ck_shipment_lines_line_version_positive', sql`${t.lineVersion} > 0`),
    idxCreatedFromLine: index('idx_shipment_lines_created_from_line').on(t.createdFromLineId),
  }),
);

export const shipmentTracking = pgTable(
  'shipment_tracking',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'cascade' })
      .notNull(),
    // Task 25 contract: V2 tracking 행은 항상 dispatch attempt 에 연결 (shipment-delivery-tracking.service:163).
    dispatchAttemptId: uuid('dispatch_attempt_id')
      .references(() => dispatchAttempts.id, { onDelete: 'restrict' })
      .notNull(),
    providerEventId: varchar('provider_event_id', { length: 255 }),
    status: shipmentStatusEnum('status').notNull(),
    location: varchar('location', { length: 255 }),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxTrackingAttempt: index('idx_shipment_tracking_attempt').on(t.dispatchAttemptId),
    uqProviderEvent: uniqueIndex('uq_shipment_tracking_provider_event')
      .on(t.dispatchAttemptId, t.providerEventId)
      .where(sql`${t.providerEventId} IS NOT NULL`),
  }),
);

/*───────────────────────────
 * SALES VARIANT POLICIES
 *──────────────────────────*/
export const salesVariantPolicies = pgTable('sales_variant_policies', {
  variantId: uuid('variant_id').primaryKey(),
  inventoryManagement: boolean('inventory_management').notNull().default(false),
  preStockSellable: boolean('pre_stock_sellable').notNull().default(false),
  alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false),
  availabilityOverride: varchar('availability_override', { length: 32 }).$type<'manual_out_of_stock' | null>(),
  effectiveFrom: timestamp('effective_from', { withTimezone: true }),
  effectiveTo: timestamp('effective_to', { withTimezone: true }),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * RETURNS
 *──────────────────────────*/
export const returns = pgTable(
  'returns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    status: returnStatusEnum('status').notNull().default('requested'),
    returnReason: varchar('return_reason', { length: 500 }), // 반품 사유
    qcInspectedAt: timestamp('qc_inspected_at', { withTimezone: true }), // QC 검사 시간
    qcInspectedBy: varchar('qc_inspected_by', { length: 128 }), // QC 검사자
    qcNotes: text('qc_notes'), // QC 검사 노트
    restockQuantity: integer('restock_quantity').notNull().default(0),
    disposeQuantity: integer('dispose_quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    warehouseIdx: index('returns_warehouse_idx').on(t.warehouseId),
    statusIdx: index('returns_status_idx').on(t.status),
    orderIdx: index('returns_order_idx').on(t.orderId),
  }),
);

export const returnItems = pgTable(
  'return_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .references(() => returns.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    requestedQuantity: integer('requested_quantity').notNull(), // 요청 수량
    receivedQuantity: integer('received_quantity').notNull().default(0), // 실제 입고 수량
    qcPassedQuantity: integer('qc_passed_quantity').notNull().default(0), // QC 통과 수량
    qcFailedQuantity: integer('qc_failed_quantity').notNull().default(0), // QC 실패 수량
    restockedQuantity: integer('restocked_quantity').notNull().default(0), // 재입고 수량
    disposedQuantity: integer('disposed_quantity').notNull().default(0), // 폐기 수량
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }), // 입고 위치
    qcStatus: varchar('qc_status', { length: 50 }).notNull().default('pending'), // pending, passed, failed
    qcReason: text('qc_reason'), // QC 결과 사유
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    returnIdx: index('return_items_return_idx').on(t.returnId),
    skuIdx: index('return_items_sku_idx').on(t.skuId),
    qcStatusIdx: index('return_items_qc_status_idx').on(t.qcStatus),
  }),
);

/*───────────────────────────
 * SETTINGS & HOLIDAYS
 *──────────────────────────*/
export const settings = pgTable('settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  warehouseId: uuid('warehouse_id')
    .references(() => warehouses.id, { onDelete: 'cascade' })
    .notNull(),
  key: settingKeyEnum('key').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const holidays = pgTable('holidays', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: timestamp('date', { mode: 'date' }).notNull(),
  name: varchar('name', { length: 128 }).notNull(),
  isCustom: boolean('is_custom').notNull().default(false),
  source: varchar('source', { length: 255 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * OUTBOX (EVENT DISPATCH)
 *──────────────────────────*/
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Task 25 contract: topic/idempotencyKey 필수. PR A 가 topicless write 를 컴파일 차단하고 fallback
    // 라우팅을 제거했으며, 운영자 cleanup 이 legacy null-topic 행을 지웠다.
    topic: varchar('topic', { length: 255 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    partitionKey: varchar('partition_key', { length: 128 }).notNull(),
    payload: json('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxStatusNext: index('idx_outbox_status_next').on(t.status, t.nextAttemptAt),
    idxTopicStatusNext: index('idx_outbox_topic_status_next').on(t.topic, t.status, t.nextAttemptAt),
    // 두 컬럼이 이제 NOT NULL 이라 partial WHERE 는 항상 참 → 일반 unique 로 단순화.
    // ck_outbox_routing_pair(both-null-or-both-set)는 NOT NULL 로 대체돼 제거.
    uqTopicEventIdempotency: uniqueIndex('uq_outbox_topic_event_idempotency').on(t.topic, t.eventType, t.idempotencyKey),
  }),
);

/*───────────────────────────
 * PURCHASE ORDERS
 *──────────────────────────*/
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: poTypeEnum('type').notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id), // 공급사 참조 추가
  expectedArrival: timestamp('expected_arrival', { mode: 'date' }),
  status: poStatusEnum('status').notNull().default('created'),

  // 최종 목적지 창고 추적을 위한 새 필드들
  sourceWarehouseId: uuid('source_warehouse_id')
    .references(() => warehouses.id, { onDelete: 'restrict' })
    .notNull(), // 직접 입고될 창고 (중국/부천)
  destinationWarehouseId: uuid('destination_warehouse_id')
    .references(() => warehouses.id, { onDelete: 'restrict' })
    .notNull(), // 최종 목적지 창고 (보통 부천)
  requiresTransfer: boolean('requires_transfer').notNull().default(false), // 창고간 이동 필요 여부

  // Audit workflow fields
  auditStatus: poAuditStatusEnum('audit_status').notNull().default('draft'),
  submittedForAuditAt: timestamp('submitted_for_audit_at', { withTimezone: true }),
  submittedForAuditBy: uuid('submitted_for_audit_by'),
  auditedAt: timestamp('audited_at', { withTimezone: true }),
  auditedBy: uuid('audited_by'),
  auditNotes: text('audit_notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const purchaseOrderLines = pgTable(
  'purchase_order_lines',
  {
    poId: uuid('po_id')
      .references(() => purchaseOrders.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price'), // 단가 추가
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.poId, t.skuId),
  }),
);

/*───────────────────────────
 * PURCHASE ORDER CART
 *──────────────────────────*/
export const purchaseOrderCart = pgTable('purchase_order_cart', {
  id: uuid('id').primaryKey().defaultRandom(),
  skuId: uuid('sku_id')
    .references(() => skus.id, { onDelete: 'restrict' })
    .notNull(),
  quantity: integer('quantity').notNull(),
  type: poTypeEnum('type').notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id, { onDelete: 'restrict' }),
  createdBy: uuid('created_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * STOCKTAKING (재고 실사)
 *──────────────────────────*/
// Stocktaking sessions table
export const stocktakingSessions = pgTable('stocktaking_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  warehouseId: uuid('warehouse_id')
    .references(() => warehouses.id, { onDelete: 'restrict' })
    .notNull(),
  sessionName: varchar('session_name', { length: 255 }).notNull(),
  status: stocktakingStatusEnum('status').notNull().default('draft'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  startedBy: uuid('started_by'), // FK to users (if available)
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Stocktaking lines table (individual count records)
export const stocktakingLines = pgTable(
  'stocktaking_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .references(() => stocktakingSessions.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'restrict' }),
    expectedQuantity: integer('expected_quantity').notNull(),
    countedQuantity: integer('counted_quantity'),
    variance: integer('variance'), // Calculated: countedQuantity - expectedQuantity
    scannedBarcode: varchar('scanned_barcode', { length: 64 }),
    status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, counted, verified
    countedAt: timestamp('counted_at', { withTimezone: true }),
    countedBy: uuid('counted_by'), // FK to users
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxStocktakingLineSession: index('idx_stocktaking_line_session').on(t.sessionId),
    idxStocktakingLineSku: index('idx_stocktaking_line_sku').on(t.skuId),
    idxStocktakingLineLocation: index('idx_stocktaking_line_location').on(t.locationId),
    uqStocktakingLine: unique('uq_stocktaking_line_session_sku_location')
      .on(t.sessionId, t.skuId, t.locationId)
      .nullsNotDistinct(),
  }),
);

// Stocktaking adjustments table (generated from variances)
export const stocktakingAdjustments = pgTable(
  'stocktaking_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .references(() => stocktakingSessions.id, { onDelete: 'restrict' })
      .notNull(),
    lineId: uuid('line_id')
      .references(() => stocktakingLines.id, { onDelete: 'restrict' })
      .notNull(),
    stockEventId: uuid('stock_event_id').references(() => stockEvents.id, { onDelete: 'restrict' }),
    adjustmentQuantity: integer('adjustment_quantity').notNull(),
    adjustmentType: varchar('adjustment_type', { length: 20 }).notNull(), // 'INCREASE' or 'DECREASE'
    reason: varchar('reason', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    appliedBy: uuid('applied_by'),
  },
  (t) => ({
    idxAdjustmentSession: index('idx_adjustment_session').on(t.sessionId),
    idxAdjustmentLine: index('idx_adjustment_line').on(t.lineId),
    uqStocktakingAdjustmentLine: unique('uq_stocktaking_adjustment_line').on(t.lineId),
  }),
);

/*───────────────────────────
 * INBOUND RECEIPTS (헤더/라인)
 *──────────────────────────*/
export const inboundReceipts = pgTable(
  'inbound_receipts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    method: inboundMethodEnum('method').notNull(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: inboundReceiptStatusEnum('status').notNull().default('posted'),
    totalQuantity: integer('total_quantity').notNull().default(0),
    journalId: uuid('journal_id').references(() => stockJournals.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxInboundReceiptsWhTime: index('idx_inbound_receipts_wh_time').on(t.warehouseId, t.occurredAt),
  }),
);

export const inboundPlans = pgTable(
  'inbound_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expectedDate: timestamp('expected_date', { mode: 'date' }),

    // 기존 warehouseId는 입고될 창고 (source)
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'cascade' })
      .notNull(),

    // 이중 입고 계획을 위한 새 필드들
    planType: planTypeEnum('plan_type').notNull().default('destination'), // 'source' | 'destination'
    parentPlanId: uuid('parent_plan_id').references((): AnyPgColumn => inboundPlans.id), // destination → source 참조
    linkedPurchaseOrderId: uuid('linked_purchase_order_id')
      .references(() => purchaseOrders.id)
      .notNull(), // 원본 발주 추적

    // 기존 필드들 (하위 호환성 유지)
    destinationWarehouseId: uuid('destination_warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(), // 최종 목적지 창고 (stockSummary 집계 기준)
    requiresTransfer: boolean('requires_transfer').notNull().default(false), // 창고간 이동 필요 여부

    status: inboundStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_inbound_plans_wh_date').on(t.warehouseId, t.expectedDate),
    index('idx_inbound_plans_destination').on(t.destinationWarehouseId, t.expectedDate),
    // 이중 입고 계획을 위한 새 인덱스들
    index('idx_inbound_plans_warehouse_type_status').on(t.warehouseId, t.planType, t.status),
    index('idx_inbound_plans_parent').on(t.parentPlanId),
    index('idx_inbound_plans_purchase_order').on(t.linkedPurchaseOrderId),
  ],
);

export const inboundPlanItems = pgTable(
  'inbound_plan_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .references(() => inboundPlans.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    expectedQty: integer('expected_qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    status: inboundStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxInboundPlanItemsPlan: index('idx_inbound_plan_items_plan').on(t.planId),
    idxInboundPlanItemsSku: index('idx_inbound_plan_items_sku').on(t.skuId),
  }),
);

export const inboundReceiptLines = pgTable(
  'inbound_receipt_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .references(() => inboundReceipts.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    originLocationId: uuid('origin_location_id').references(() => locations.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
    memo: varchar('memo', { length: 255 }),
    // counters for domain invariants
    returnedQty: integer('returned_qty').notNull().default(0),
    canceledQty: integer('canceled_qty').notNull().default(0),
    putawayFromOriginQty: integer('putaway_from_origin_qty').notNull().default(0),
    // optional link to plan item
    planItemId: uuid('plan_item_id').references(() => inboundPlanItems.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxInboundLinesReceipt: index('idx_inbound_lines_receipt').on(t.receiptId),
    idxInboundLinesSku: index('idx_inbound_lines_sku').on(t.skuId),
  }),
);

/*───────────────────────────
 * INBOUND WORK LOGS (타임라인)
 *──────────────────────────*/
export const inboundWorkLogs = pgTable(
  'inbound_work_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: inboundWorkTypeEnum('type').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
    receiptId: uuid('receipt_id').references(() => inboundReceipts.id, { onDelete: 'set null' }),
    lineId: uuid('line_id').references(() => inboundReceiptLines.id, { onDelete: 'set null' }),
    planItemId: uuid('plan_item_id').references(() => inboundPlanItems.id, { onDelete: 'set null' }),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'set null' }),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
    fromLocationId: uuid('from_location_id').references(() => locations.id, { onDelete: 'set null' }),
    toLocationId: uuid('to_location_id').references(() => locations.id, { onDelete: 'set null' }),
    quantity: integer('quantity'),
    method: inboundMethodEnum('method'),
    reason: varchar('reason', { length: 255 }),
    eventId: uuid('event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
  },
  (t) => ({
    idxInboundWorkTime: index('idx_inbound_work_time').on(t.timestamp),
  }),
);

/*───────────────────────────
 * AUDIT LOGS
 *──────────────────────────*/
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: auditEventTypeEnum('event_type').notNull(),
    severity: auditSeverityEnum('severity').notNull().default('INFO'),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),

    // 사용자 정보
    userId: varchar('user_id', { length: 255 }),
    userAgent: text('user_agent'),
    ipAddress: varchar('ip_address', { length: 45 }),

    // 리소스 정보
    resourceType: varchar('resource_type', { length: 100 }), // 'order', 'sku', 'stock' 등
    resourceId: varchar('resource_id', { length: 255 }),
    resourceName: text('resource_name'),

    // 변경 정보 (before/after)
    changesBefore: jsonb('changes_before'),
    changesAfter: jsonb('changes_after'),

    // 컨텍스트 정보
    action: varchar('action', { length: 100 }).notNull(), // 'create', 'update', 'delete' 등
    module: varchar('module', { length: 50 }).notNull(), // 'inventory', 'order', 'fulfillment' 등
    description: text('description'), // 사람이 읽을 수 있는 설명

    // 추가 메타데이터
    metadata: jsonb('metadata'), // 추가적인 컨텍스트 정보
    errorMessage: text('error_message'), // 에러 발생 시
    stackTrace: text('stack_trace'), // 에러 스택 트레이스

    // 상관관계 ID (같은 트랜잭션/요청의 로그들을 그룹화)
    correlationId: varchar('correlation_id', { length: 255 }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // 인덱스 생성
    idxAuditTimestamp: index('idx_audit_timestamp').on(t.timestamp.desc()),
    idxAuditEventType: index('idx_audit_event_type').on(t.eventType),
    idxAuditResourceType: index('idx_audit_resource_type').on(t.resourceType),
    idxAuditResourceId: index('idx_audit_resource_id').on(t.resourceId),
    idxAuditModule: index('idx_audit_module').on(t.module),
    idxAuditSeverity: index('idx_audit_severity').on(t.severity),
    idxAuditUserId: index('idx_audit_user_id').on(t.userId),
    idxAuditCorrelationId: index('idx_audit_correlation_id').on(t.correlationId),

    // 복합 인덱스
    idxAuditResourceSearch: index('idx_audit_resource_search').on(t.resourceType, t.resourceId),
    idxAuditTimeModule: index('idx_audit_time_module').on(t.timestamp.desc(), t.module),
  }),
);

/*───────────────────────────
 * PRODUCT-SKU MAPPING SYSTEM
 *──────────────────────────*/

/**
 * 판매상품→재고상품 매핑 규칙 (현재 활성 매핑)
 */
export const productSkuMappings = pgTable(
  'product_sku_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: varchar('product_id', { length: 255 }).notNull(), // PIM의 판매상품 ID
    version: integer('version').notNull().default(1),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxProductWarehouse: index('idx_product_sku_mappings_product_warehouse').on(t.productId, t.warehouseId),
    idxActiveVersion: index('idx_product_sku_mappings_active').on(t.productId, t.warehouseId, t.isActive),
  }),
);

export const productSkuMappingItems = pgTable(
  'product_sku_mapping_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingId: uuid('mapping_id')
      .references(() => productSkuMappings.id, { onDelete: 'cascade' })
      .notNull(),
    variantId: uuid('variant_id').notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    qtyPerProduct: integer('qty_per_product').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxMapping: index('idx_product_sku_mapping_items_mapping').on(t.mappingId),
    uqMappingVariant: index('uq_product_sku_mapping_items_mapping_variant').on(t.mappingId, t.variantId),
  }),
);

/**
 * 주문시점 매핑 스냅샷 (불변)
 */
export const productSkuMappingSnapshots = pgTable(
  'product_sku_mapping_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: varchar('product_id', { length: 255 }).notNull(),
    sourceVersion: integer('source_version').notNull(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    snapshotData: json('snapshot_data').notNull(), // { items: [{ skuId, qtyPerProduct }] }

    // 에러 로그에서 필요한 추가 컬럼들
    variantId: uuid('variant_id').notNull(), // PIM variant ID
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    mappingId: uuid('mapping_id').references(() => productSkuMappings.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxProduct: index('idx_product_sku_mapping_snapshots_product').on(t.productId),
  }),
);

/*───────────────────────────
 * FULFILLMENT ORDER ITEMS (FOI) - 핵심 확장
 *──────────────────────────*/

/**
 * 출고주문 아이템 - SO의 판매상품을 SKU로 변환하여 저장
 */
export const fulfillmentOrderItems = pgTable(
  'fulfillment_order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentOrderId: uuid('fulfillment_order_id')
      .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
      .notNull(),

    // 추적 정보 (nullable: 명시적 라인 전달 시 SO 정보가 없을 수 있음)
    salesOrderId: varchar('sales_order_id', { length: 255 }), // 원본 SO ID
    salesOrderLineId: varchar('sales_order_line_id', { length: 255 }), // 원본 SOL ID
    mappingSnapshotId: uuid('mapping_snapshot_id').references(() => productSkuMappingSnapshots.id, {
      onDelete: 'restrict',
    }),
    variantId: uuid('variant_id'), // PIM Variant ID - 정책 평가용

    // 실제 출고 정보
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    qty: integer('qty').notNull(),

    // 진행 상태
    reservedQty: integer('reserved_qty').notNull().default(0),
    pickedQty: integer('picked_qty').notNull().default(0),
    shippedQty: integer('shipped_qty').notNull().default(0),
    canceledQty: integer('canceled_qty').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('pending'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxFulfillmentOrder: index('idx_fulfillment_order_items_fo').on(t.fulfillmentOrderId),
    idxSalesOrder: index('idx_fulfillment_order_items_so').on(t.salesOrderId),
    idxSku: index('idx_fulfillment_order_items_sku').on(t.skuId),
    idxVariant: index('idx_fulfillment_order_items_variant').on(t.variantId),
    ckQtyPositive: check('ck_fulfillment_order_items_qty_positive', sql`${t.qty} > 0`),
    ckProgressNonnegative: check(
      'ck_fulfillment_order_items_progress_nonnegative',
      sql`${t.reservedQty} >= 0 AND ${t.pickedQty} >= 0 AND ${t.shippedQty} >= 0 AND ${t.canceledQty} >= 0`,
    ),
    ckSettledWithinQty: check(
      'ck_fulfillment_order_items_settled_within_qty',
      sql`${t.shippedQty} + ${t.canceledQty} <= ${t.qty}`,
    ),
  }),
);

/*───────────────────────────
 * INSPECTION (검수) — inspection_issues 만 영속(세션/아이템 폐기, 박스 라인으로 흡수)
 *──────────────────────────*/

// 검수 이슈 (불량/수량불일치 등). FOI 단위 누적 기록
export const inspectionIssues = pgTable(
  'inspection_issues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foiId: uuid('foi_id')
      .references(() => fulfillmentOrderItems.id, { onDelete: 'cascade' })
      .notNull(),
    // 구 sessionId(→inspection_sessions, 폐기) → 박스 참조.
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    type: varchar('type', { length: 32 }).notNull(), // quantity_mismatch | quality_issue | damage | wrong_item | other
    severity: varchar('severity', { length: 16 }).notNull(), // minor | major | critical
    description: text('description').notNull().default(''),
    qty: integer('qty'),
    inspectorUserId: varchar('inspector_user_id', { length: 255 }),
    photos: jsonb('photos').$type<string[]>(),
    reportedAt: timestamp('reported_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolution: text('resolution'),
  },
  (t) => ({
    idxFoi: index('idx_inspection_issues_foi').on(t.foiId),
    idxShipment: index('idx_inspection_issues_shipment').on(t.shipmentId),
  }),
);

/*───────────────────────────
 * OUTBOUND BATCH SYSTEM
 *──────────────────────────*/

export const outboundBatches = pgTable(
  'outbound_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchNumber: varchar('batch_number', { length: 64 }).notNull().unique(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    status: batchStatusEnum('status').notNull().default('created'),
    pickingMethod: pickingMethodEnum('picking_method').notNull(),
    cartCapacity: integer('cart_capacity'), // 토탈피킹 시 바구니 수
    name: varchar('name', { length: 255 }),
    // Task 25 contract: assignedTo/totalItems/totalQty 제거 (writer 0 또는 상수 insert 뿐, reader 없음).
    scheduledPickingAt: timestamp('scheduled_picking_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    idxWarehouseStatus: index('idx_outbound_batches_warehouse_status').on(t.warehouseId, t.status),
    idxBatchNumber: index('idx_outbound_batches_number').on(t.batchNumber),
  }),
);

// Task 25 contract: fulfillment_order_batches(FO↔batch 링크 테이블) 제거 — non-spec 사용 0.
// V2 batch 단위는 FO 가 아니라 shipment 다(outbound_batch_work_items). outbound_batches 는 존치.

/*───────────────────────────
 * OUTBOUND V2 EXPAND MODEL
 * Additive foundation for idempotent shipment planning, custody and dispatch.
 *──────────────────────────*/

export const fulfillmentCommandRequests = pgTable(
  'fulfillment_command_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    commandType: varchar('command_type', { length: 128 }).notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    status: fulfillmentCommandRequestStatusEnum('status').notNull().default('pending'),
    resourceType: varchar('resource_type', { length: 64 }),
    resourceId: uuid('resource_id'),
    // Polymorphic correlation to shipment_operations (구 invoice_operations 대상은 contract phase 에서 드롭됨).
    // command handlers validate operationId against resourceType inside their transaction.
    operationId: uuid('operation_id'),
    attemptId: uuid('attempt_id').references(() => dispatchAttempts.id, { onDelete: 'restrict' }),
    responseSnapshot: jsonb('response_snapshot'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    uqCommandIdempotency: unique('uq_fulfillment_command_idempotency').on(t.commandType, t.idempotencyKey),
    idxCommandStatus: index('idx_fulfillment_command_status').on(t.status, t.createdAt),
    idxCommandOperation: index('idx_fulfillment_command_operation').on(t.operationId),
    idxCommandAttempt: index('idx_fulfillment_command_attempt').on(t.attemptId),
    ckCommandRequestHash: check('ck_fulfillment_command_request_hash', sql`length(${t.requestHash}) = 64`),
    ckCommandCompletion: check(
      'ck_fulfillment_command_completion',
      sql`${t.status} <> 'completed' OR (${t.completedAt} IS NOT NULL AND ${t.responseSnapshot} IS NOT NULL)`,
    ),
    ckCommandFailure: check(
      'ck_fulfillment_command_failure',
      sql`${t.status} <> 'failed' OR ${t.lastError} IS NOT NULL`,
    ),
  }),
);

export const shipmentOperations = pgTable(
  'shipment_operations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: shipmentOperationTypeEnum('type').notNull(),
    status: shipmentOperationStatusEnum('status').notNull().default('pending'),
    operatorId: uuid('operator_id').notNull(),
    reason: varchar('reason', { length: 255 }).notNull(),
    csCaseId: uuid('cs_case_id'),
    note: text('note'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    beforeManifestSnapshot: jsonb('before_manifest_snapshot'),
    afterManifestSnapshot: jsonb('after_manifest_snapshot'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    uqShipmentOperationIdempotency: unique('uq_shipment_operation_idempotency').on(t.type, t.idempotencyKey),
    // Allows immutable picking-plan retirement history to prove that its owner
    // is the exact shipment operation/type pair, not merely an arbitrary UUID.
    uqShipmentOperationIdType: unique('uq_shipment_operations_id_type').on(t.id, t.type),
    idxShipmentOperationStatus: index('idx_shipment_operation_status').on(t.status, t.createdAt),
    ckShipmentOperationRequestHash: check('ck_shipment_operation_request_hash', sql`length(${t.requestHash}) = 64`),
    ckShipmentOperationCompletion: check(
      'ck_shipment_operation_completion',
      sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
    ckShipmentOperationErrorContext: check(
      'ck_shipment_operation_error_context',
      sql`${t.status} NOT IN ('failed', 'recovery_required') OR ${t.lastError} IS NOT NULL`,
    ),
  }),
);

export const shipmentOperationMembers = pgTable(
  'shipment_operation_members',
  {
    operationId: uuid('operation_id')
      .references(() => shipmentOperations.id, { onDelete: 'restrict' })
      .notNull(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    role: shipmentOperationMemberRoleEnum('role').notNull(),
    beforeManifestVersion: integer('before_manifest_version'),
    afterManifestVersion: integer('after_manifest_version'),
    beforeManifestSnapshot: jsonb('before_manifest_snapshot'),
    afterManifestSnapshot: jsonb('after_manifest_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.operationId, t.shipmentId, t.role),
    idxShipmentOperationMemberShipment: index('idx_shipment_operation_members_shipment').on(t.shipmentId),
    ckShipmentOperationVersions: check(
      'ck_shipment_operation_member_versions',
      sql`(${t.beforeManifestVersion} IS NULL OR ${t.beforeManifestVersion} > 0)
        AND (${t.afterManifestVersion} IS NULL OR ${t.afterManifestVersion} > 0)`,
    ),
  }),
);

export const waybillStatusEnum = pgEnum('waybill_status', [
  'pending',
  'allocated',
  'registered',
  'used',
  'voided',
  'failed',
  'abandoned',
]);
export const waybillSourceEnum = pgEnum('waybill_source', ['carrier', 'manual']);

export const waybills = pgTable(
  'waybills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    source: waybillSourceEnum('source').notNull(),
    carrier: carrierEnum('carrier').notNull(),
    status: waybillStatusEnum('status').notNull().default('pending'),
    trackingNo: varchar('tracking_no', { length: 128 }),
    custOrdNo: varchar('cust_ord_no', { length: 30 }),
    labelData: jsonb('label_data'),
    manifestVersion: integer('manifest_version').notNull(),
    recipientHash: varchar('recipient_hash', { length: 64 }).notNull(),
    lastError: text('last_error'),
    attempts: integer('attempts').notNull().default(0),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxShipment: index('idx_waybills_shipment').on(t.shipmentId),
    idxStatus: index('idx_waybills_status').on(t.status),
    idxTrackingNo: index('idx_waybills_tracking_no').on(t.trackingNo),
    // shipment 당 활성 운송장 1개. 종료 3상태(voided/failed/abandoned) 슬롯 해제.
    uqActivePerShipment: uniqueIndex('uq_waybills_shipment_active')
      .on(t.shipmentId)
      .where(sql`${t.status} NOT IN ('voided', 'failed', 'abandoned')`),
    // live 운송장 사이에서만 trackingNo 유일(멱등 앵커). 종료 상태 제외라 오void 번호 재등록 허용.
    uqLiveTrackingNo: uniqueIndex('uq_waybills_tracking_live')
      .on(t.trackingNo)
      .where(sql`${t.trackingNo} IS NOT NULL AND ${t.status} NOT IN ('voided', 'failed', 'abandoned')`),
    ckTrackingPresent: check(
      'ck_waybills_tracking_present',
      sql`${t.status} NOT IN ('allocated', 'registered', 'used') OR ${t.trackingNo} IS NOT NULL`,
    ),
    ckManualStatus: check(
      'ck_waybills_manual_status',
      sql`${t.source} <> 'manual' OR ${t.status} IN ('registered', 'used', 'voided')`,
    ),
    ckAttempts: check('ck_waybills_attempts', sql`${t.attempts} >= 0`),
    ckRecipientHash: check('ck_waybills_recipient_hash', sql`length(${t.recipientHash}) = 64`),
    ckManifestVersion: check('ck_waybills_manifest_version', sql`${t.manifestVersion} > 0`),
  }),
);

export const outboundBatchWorkItems = pgTable(
  'outbound_batch_work_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .references(() => outboundBatches.id, { onDelete: 'restrict' })
      .notNull(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    status: outboundBatchWorkItemStatusEnum('status').notNull().default('queued'),
    pickerId: uuid('picker_id'),
    pickerClaimedAt: timestamp('picker_claimed_at', { withTimezone: true }),
    pickerReleasedAt: timestamp('picker_released_at', { withTimezone: true }),
    packerId: uuid('packer_id'),
    packerClaimedAt: timestamp('packer_claimed_at', { withTimezone: true }),
    packerReleasedAt: timestamp('packer_released_at', { withTimezone: true }),
    handedOffAt: timestamp('handed_off_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
    leaseVersion: integer('lease_version').notNull().default(0),
    exclusionReason: text('exclusion_reason'),
    recoveryReason: text('recovery_reason'),
    waitingOperationId: uuid('waiting_operation_id').references(() => shipmentOperations.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqActiveWorkItemPerShipment: uniqueIndex('uq_outbound_work_item_active_shipment')
      .on(t.shipmentId)
      .where(sql`${t.status} NOT IN ('completed', 'excluded')`),
    idxOutboundWorkItemBatchStatus: index('idx_outbound_work_items_batch_status').on(t.batchId, t.status),
    idxOutboundWorkItemWaitingOperation: index('idx_outbound_work_items_waiting_operation').on(t.waitingOperationId),
    ckOutboundWorkItemLeaseVersion: check('ck_outbound_work_items_lease_version', sql`${t.leaseVersion} >= 0`),
    ckOutboundWorkItemExclusion: check(
      'ck_outbound_work_items_exclusion',
      sql`${t.status} <> 'excluded' OR ${t.exclusionReason} IS NOT NULL`,
    ),
    ckOutboundWorkItemRecovery: check(
      'ck_outbound_work_items_recovery',
      sql`${t.status} <> 'short_pick_recovery' OR ${t.recoveryReason} IS NOT NULL`,
    ),
    ckOutboundWorkItemCompletion: check(
      'ck_outbound_work_items_completion',
      sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
    ckOutboundWorkItemPickerRelease: check(
      'ck_outbound_work_items_picker_release',
      sql`${t.pickerReleasedAt} IS NULL OR (${t.pickerClaimedAt} IS NOT NULL AND ${t.pickerReleasedAt} >= ${t.pickerClaimedAt})`,
    ),
    ckOutboundWorkItemPackerRelease: check(
      'ck_outbound_work_items_packer_release',
      sql`${t.packerReleasedAt} IS NULL OR (${t.packerClaimedAt} IS NOT NULL AND ${t.packerReleasedAt} >= ${t.packerClaimedAt})`,
    ),
  }),
);

export const pickingPlans = pgTable(
  'picking_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .references(() => outboundBatches.id, { onDelete: 'restrict' })
      .notNull(),
    // Task 15 validates that this strategy belongs to the warehouse capability array.
    strategy: pickingStrategyEnum('strategy').notNull(),
    status: pickingPlanStatusEnum('status').notNull().default('draft'),
    version: integer('version').notNull().default(1),
    createdBy: uuid('created_by').notNull(),
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
    invalidationReason: text('invalidation_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqPickingPlanVersion: unique('uq_picking_plans_batch_version').on(t.batchId, t.version),
    idxPickingPlanStatus: index('idx_picking_plans_batch_status').on(t.batchId, t.status),
    ckPickingPlanVersion: check('ck_picking_plans_version_positive', sql`${t.version} > 0`),
    ckPickingPlanInvalidation: check(
      'ck_picking_plans_invalidation',
      sql`${t.status} <> 'invalidated' OR (${t.invalidatedAt} IS NOT NULL AND ${t.invalidationReason} IS NOT NULL)`,
    ),
  }),
);

export const pickingPlanMembers = pgTable(
  'picking_plan_members',
  {
    planId: uuid('plan_id')
      .references(() => pickingPlans.id, { onDelete: 'restrict' })
      .notNull(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    manifestVersion: integer('manifest_version').notNull(),
    reservationVersion: integer('reservation_version').notNull(),
    retiredAt: timestamp('retired_at', { withTimezone: true }),
    retireReason: text('retire_reason'),
    retiredByOperationId: uuid('retired_by_operation_id'),
    retiredByOperationType: shipmentOperationTypeEnum('retired_by_operation_type'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.planId, t.shipmentId),
    idxPickingPlanMemberShipment: index('idx_picking_plan_members_shipment').on(t.shipmentId),
    idxActivePickingPlanMemberShipment: index('idx_picking_plan_members_active_shipment')
      .on(t.shipmentId)
      .where(sql`${t.retiredAt} IS NULL`),
    fkPickingPlanMemberRetirementOperation: foreignKey({
      name: 'fk_picking_plan_member_retirement_operation',
      columns: [t.retiredByOperationId, t.retiredByOperationType],
      foreignColumns: [shipmentOperations.id, shipmentOperations.type],
    }).onDelete('restrict'),
    ckPickingPlanMemberVersions: check(
      'ck_picking_plan_member_versions',
      sql`${t.manifestVersion} > 0 AND ${t.reservationVersion} > 0`,
    ),
    ckPickingPlanMemberRetirement: check(
      'ck_picking_plan_member_retirement',
      sql`(
        ${t.retiredAt} IS NULL
        AND ${t.retireReason} IS NULL
        AND ${t.retiredByOperationId} IS NULL
        AND ${t.retiredByOperationType} IS NULL
      ) OR (
        ${t.retiredAt} IS NOT NULL
        AND ${t.retireReason} IS NOT NULL
        AND length(btrim(${t.retireReason})) > 0
        AND ${t.retiredByOperationId} IS NOT NULL
        AND ${t.retiredByOperationType} IS NOT NULL
        AND ${t.retiredByOperationType} = 'short_pick'
        AND ${t.retiredAt} >= ${t.createdAt}
      )`,
    ),
  }),
);

export const pickingSourceAllocations = pgTable(
  'picking_source_allocations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .references(() => pickingPlans.id, { onDelete: 'restrict' })
      .notNull(),
    shipmentLineId: uuid('shipment_line_id')
      .references(() => shipmentLines.id, { onDelete: 'restrict' })
      .notNull(),
    sourceLocationId: uuid('source_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),
    qty: integer('qty').notNull(),
    sourceStockVersion: integer('source_stock_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqPickingSourceGrain: unique('uq_picking_source_allocations_grain').on(
      t.planId,
      t.shipmentLineId,
      t.sourceLocationId,
    ),
    idxPickingAllocationLine: index('idx_picking_source_allocations_line').on(t.shipmentLineId),
    ckPickingAllocationQty: check('ck_picking_source_allocations_qty_positive', sql`${t.qty} > 0`),
    ckPickingAllocationStockVersion: check(
      'ck_picking_source_allocations_stock_version',
      sql`${t.sourceStockVersion} > 0`,
    ),
  }),
);

export const batchInventorySessions = pgTable(
  'batch_inventory_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    batchId: uuid('batch_id')
      .references(() => outboundBatches.id, { onDelete: 'restrict' })
      .notNull(),
    status: batchInventorySessionStatusEnum('status').notNull().default('active'),
    version: integer('version').notNull().default(1),
    handedInQty: integer('handed_in_qty').notNull().default(0),
    settledQty: integer('settled_qty').notNull().default(0),
    returnedQty: integer('returned_qty').notNull().default(0),
    shortageQty: integer('shortage_qty').notNull().default(0),
    recoveryReason: text('recovery_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqActiveSessionPerBatch: uniqueIndex('uq_batch_inventory_sessions_active_batch')
      .on(t.batchId)
      .where(sql`${t.status} IN ('active', 'recovery_required')`),
    idxBatchInventorySessionStatus: index('idx_batch_inventory_sessions_status').on(t.status, t.startedAt),
    ckBatchInventorySessionVersion: check('ck_batch_inventory_sessions_version_positive', sql`${t.version} > 0`),
    ckBatchInventorySessionQuantities: check(
      'ck_batch_inventory_sessions_quantities',
      sql`${t.handedInQty} >= 0 AND ${t.settledQty} >= 0 AND ${t.returnedQty} >= 0 AND ${t.shortageQty} >= 0`,
    ),
    ckBatchInventorySessionSettlement: check(
      'ck_batch_inventory_sessions_settlement',
      sql`${t.settledQty} + ${t.returnedQty} + ${t.shortageQty} <= ${t.handedInQty}`,
    ),
    ckBatchInventorySessionRecovery: check(
      'ck_batch_inventory_sessions_recovery',
      sql`${t.status} <> 'recovery_required' OR ${t.recoveryReason} IS NOT NULL`,
    ),
  }),
);

export const batchInventorySessionBalances = pgTable(
  'batch_inventory_session_balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .references(() => batchInventorySessions.id, { onDelete: 'restrict' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    sourceLocationId: uuid('source_location_id').references(() => locations.id, { onDelete: 'restrict' }),
    custodyType: batchInventoryCustodyTypeEnum('custody_type').notNull(),
    custodyRef: varchar('custody_ref', { length: 255 }),
    shipmentLineId: uuid('shipment_line_id').references(() => shipmentLines.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull().default(0),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqBatchInventoryBalanceGrain: unique('uq_batch_inventory_session_balance_grain')
      .on(t.sessionId, t.skuId, t.sourceLocationId, t.custodyType, t.custodyRef, t.shipmentLineId)
      .nullsNotDistinct(),
    idxBatchInventoryBalanceSession: index('idx_batch_inventory_session_balances_session').on(
      t.sessionId,
      t.custodyType,
    ),
    idxBatchInventoryBalanceShipmentLine: index('idx_batch_inventory_session_balances_line').on(t.shipmentLineId),
    ckBatchInventoryBalanceQty: check('ck_batch_inventory_session_balances_qty', sql`${t.qty} >= 0`),
    ckBatchInventoryBalanceVersion: check('ck_batch_inventory_session_balances_version', sql`${t.version} > 0`),
    ckBatchInventoryBalanceCustody: check(
      'ck_batch_inventory_session_balances_custody',
      sql`(
        (${t.custodyType} = 'AT_SOURCE' AND ${t.sourceLocationId} IS NOT NULL AND ${t.custodyRef} IS NULL AND ${t.shipmentLineId} IS NULL)
        OR (${t.custodyType} = 'BULK_CART' AND ${t.sourceLocationId} IS NOT NULL AND ${t.custodyRef} IS NOT NULL AND ${t.shipmentLineId} IS NULL)
        OR (${t.custodyType} IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND ${t.sourceLocationId} IS NOT NULL AND ${t.custodyRef} IS NOT NULL AND ${t.shipmentLineId} IS NOT NULL)
        OR (${t.custodyType} IN ('RETURN_PENDING', 'SETTLED') AND ${t.sourceLocationId} IS NOT NULL AND ${t.custodyRef} IS NULL AND ${t.shipmentLineId} IS NOT NULL)
      )`,
    ),
  }),
);

export const batchInventorySessionEvents = pgTable(
  'batch_inventory_session_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .references(() => batchInventorySessions.id, { onDelete: 'restrict' })
      .notNull(),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id, { onDelete: 'restrict' })
      .notNull(),
    quantity: integer('quantity').notNull(),
    fromCustodyType: batchInventoryCustodyTypeEnum('from_custody_type'),
    fromCustodyRef: varchar('from_custody_ref', { length: 255 }),
    fromSourceLocationId: uuid('from_source_location_id').references(() => locations.id, { onDelete: 'restrict' }),
    fromShipmentLineId: uuid('from_shipment_line_id').references(() => shipmentLines.id, { onDelete: 'restrict' }),
    toCustodyType: batchInventoryCustodyTypeEnum('to_custody_type'),
    toCustodyRef: varchar('to_custody_ref', { length: 255 }),
    toSourceLocationId: uuid('to_source_location_id').references(() => locations.id, { onDelete: 'restrict' }),
    toShipmentLineId: uuid('to_shipment_line_id').references(() => shipmentLines.id, { onDelete: 'restrict' }),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqBatchInventorySessionEventIdempotency: unique('uq_batch_inventory_session_event_idempotency').on(
      t.sessionId,
      t.idempotencyKey,
    ),
    idxBatchInventorySessionEventFromLocation: index('idx_batch_inventory_session_events_from_location').on(
      t.fromSourceLocationId,
    ),
    idxBatchInventorySessionEventToLocation: index('idx_batch_inventory_session_events_to_location').on(
      t.toSourceLocationId,
    ),
    idxBatchInventorySessionEventFromLine: index('idx_batch_inventory_session_events_from_line').on(
      t.fromShipmentLineId,
    ),
    idxBatchInventorySessionEventToLine: index('idx_batch_inventory_session_events_to_line').on(t.toShipmentLineId),
    ckBatchInventorySessionEventQty: check('ck_batch_inventory_session_events_qty_positive', sql`${t.quantity} > 0`),
    ckBatchInventorySessionEventSides: check(
      'ck_batch_inventory_session_events_sides',
      sql`${t.fromCustodyType} IS NOT NULL OR ${t.toCustodyType} IS NOT NULL`,
    ),
    ckBatchInventorySessionEventFromGrain: check(
      'ck_batch_inventory_session_events_from_grain',
      sql`(
        (${t.fromCustodyType} IS NULL AND ${t.fromSourceLocationId} IS NULL AND ${t.fromCustodyRef} IS NULL AND ${t.fromShipmentLineId} IS NULL)
        OR (${t.fromCustodyType} IS NOT NULL AND (
          (${t.fromCustodyType} = 'AT_SOURCE' AND ${t.fromSourceLocationId} IS NOT NULL AND ${t.fromCustodyRef} IS NULL AND ${t.fromShipmentLineId} IS NULL)
          OR (${t.fromCustodyType} = 'BULK_CART' AND ${t.fromSourceLocationId} IS NOT NULL AND ${t.fromCustodyRef} IS NOT NULL AND ${t.fromShipmentLineId} IS NULL)
          OR (${t.fromCustodyType} IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND ${t.fromSourceLocationId} IS NOT NULL AND ${t.fromCustodyRef} IS NOT NULL AND ${t.fromShipmentLineId} IS NOT NULL)
          OR (${t.fromCustodyType} IN ('RETURN_PENDING', 'SETTLED') AND ${t.fromSourceLocationId} IS NOT NULL AND ${t.fromCustodyRef} IS NULL AND ${t.fromShipmentLineId} IS NOT NULL)
        ))
      )`,
    ),
    ckBatchInventorySessionEventToGrain: check(
      'ck_batch_inventory_session_events_to_grain',
      sql`(
        (${t.toCustodyType} IS NULL AND ${t.toSourceLocationId} IS NULL AND ${t.toCustodyRef} IS NULL AND ${t.toShipmentLineId} IS NULL)
        OR (${t.toCustodyType} IS NOT NULL AND (
          (${t.toCustodyType} = 'AT_SOURCE' AND ${t.toSourceLocationId} IS NOT NULL AND ${t.toCustodyRef} IS NULL AND ${t.toShipmentLineId} IS NULL)
          OR (${t.toCustodyType} = 'BULK_CART' AND ${t.toSourceLocationId} IS NOT NULL AND ${t.toCustodyRef} IS NOT NULL AND ${t.toShipmentLineId} IS NULL)
          OR (${t.toCustodyType} IN ('WORKER', 'TOTE', 'SORTING', 'PACKING', 'PACKED') AND ${t.toSourceLocationId} IS NOT NULL AND ${t.toCustodyRef} IS NOT NULL AND ${t.toShipmentLineId} IS NOT NULL)
          OR (${t.toCustodyType} IN ('RETURN_PENDING', 'SETTLED') AND ${t.toSourceLocationId} IS NOT NULL AND ${t.toCustodyRef} IS NULL AND ${t.toShipmentLineId} IS NOT NULL)
        ))
      )`,
    ),
  }),
);

export const totes = pgTable(
  'totes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id')
      .references(() => warehouses.id, { onDelete: 'restrict' })
      .notNull(),
    barcode: varchar('barcode', { length: 128 }).notNull(),
    status: toteStatusEnum('status').notNull().default('available'),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqToteBarcode: unique('uq_totes_barcode').on(t.barcode),
    idxToteWarehouseStatus: index('idx_totes_warehouse_status').on(t.warehouseId, t.status),
    ckToteVersion: check('ck_totes_version_positive', sql`${t.version} > 0`),
  }),
);

export const shipmentToteAssignments = pgTable(
  'shipment_tote_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    toteId: uuid('tote_id')
      .references(() => totes.id, { onDelete: 'restrict' })
      .notNull(),
    assignedBy: uuid('assigned_by').notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
  },
  (t) => ({
    uqActiveToteAssignment: uniqueIndex('uq_shipment_tote_assignments_active_tote')
      .on(t.toteId)
      .where(sql`${t.releasedAt} IS NULL`),
    uqActiveShipmentToteAssignment: uniqueIndex('uq_shipment_tote_assignments_active_pair')
      .on(t.shipmentId, t.toteId)
      .where(sql`${t.releasedAt} IS NULL`),
    idxShipmentToteAssignmentShipment: index('idx_shipment_tote_assignments_shipment').on(t.shipmentId),
    ckShipmentToteRelease: check(
      'ck_shipment_tote_assignments_release',
      sql`${t.releasedAt} IS NULL OR ${t.releasedAt} >= ${t.assignedAt}`,
    ),
  }),
);

export const dispatchAttempts = pgTable(
  'dispatch_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id')
      .references(() => shipments.id, { onDelete: 'restrict' })
      .notNull(),
    attemptNo: integer('attempt_no').notNull(),
    status: dispatchAttemptStatusEnum('status').notNull().default('pending'),
    idempotencyKey: varchar('idempotency_key', { length: 255 }).notNull(),
    // waybill 모듈 컷오버(플랜3): 구 invoice_id 를 대체. Task 12에서 invoice_id 컬럼 드롭 완료.
    waybillId: uuid('waybill_id').references(() => waybills.id, { onDelete: 'restrict' }),
    stockJournalId: uuid('stock_journal_id').references(() => stockJournals.id, { onDelete: 'restrict' }),
    reversalJournalId: uuid('reversal_journal_id').references(() => stockJournals.id, { onDelete: 'restrict' }),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    carrierAcceptedAt: timestamp('carrier_accepted_at', { withTimezone: true }),
    recalledAt: timestamp('recalled_at', { withTimezone: true }),
    recoveryCode: varchar('recovery_code', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqDispatchAttemptNo: unique('uq_dispatch_attempts_shipment_attempt').on(t.shipmentId, t.attemptNo),
    uqDispatchAttemptIdempotency: unique('uq_dispatch_attempts_idempotency').on(t.idempotencyKey),
    uqDispatchAttemptJournal: uniqueIndex('uq_dispatch_attempts_stock_journal')
      .on(t.stockJournalId)
      .where(sql`${t.stockJournalId} IS NOT NULL`),
    uqDispatchAttemptReversalJournal: uniqueIndex('uq_dispatch_attempts_reversal_journal')
      .on(t.reversalJournalId)
      .where(sql`${t.reversalJournalId} IS NOT NULL`),
    idxDispatchAttemptShipmentStatus: index('idx_dispatch_attempts_shipment_status').on(t.shipmentId, t.status),
    ckDispatchAttemptNo: check('ck_dispatch_attempts_attempt_no_positive', sql`${t.attemptNo} > 0`),
    ckDispatchAttemptDispatched: check(
      'ck_dispatch_attempts_dispatched_at',
      sql`${t.status} NOT IN ('dispatched', 'recalled') OR (${t.dispatchedAt} IS NOT NULL AND ${t.stockJournalId} IS NOT NULL)`,
    ),
    ckDispatchAttemptRecalled: check(
      'ck_dispatch_attempts_recalled_at',
      sql`${t.status} <> 'recalled' OR (${t.recalledAt} IS NOT NULL AND ${t.reversalJournalId} IS NOT NULL)`,
    ),
    ckDispatchAttemptDistinctJournals: check(
      'ck_dispatch_attempts_distinct_journals',
      sql`${t.stockJournalId} IS NULL OR ${t.reversalJournalId} IS NULL OR ${t.stockJournalId} <> ${t.reversalJournalId}`,
    ),
    ckDispatchAttemptRecallChronology: check(
      'ck_dispatch_attempts_recall_chronology',
      sql`${t.status} <> 'recalled' OR ${t.recalledAt} >= ${t.dispatchedAt}`,
    ),
    ckDispatchAttemptRecallCarrier: check(
      'ck_dispatch_attempts_recall_carrier',
      sql`${t.status} <> 'recalled' OR ${t.carrierAcceptedAt} IS NULL`,
    ),
    ckDispatchAttemptCarrierAcceptance: check(
      'ck_dispatch_attempts_carrier_acceptance',
      sql`${t.carrierAcceptedAt} IS NULL OR (${t.dispatchedAt} IS NOT NULL AND ${t.carrierAcceptedAt} >= ${t.dispatchedAt})`,
    ),
    ckDispatchAttemptRecovery: check(
      'ck_dispatch_attempts_recovery_code',
      sql`${t.status} <> 'recovery_required' OR ${t.recoveryCode} IS NOT NULL`,
    ),
  }),
);

export const dispatchAttemptSources = pgTable(
  'dispatch_attempt_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    dispatchAttemptId: uuid('dispatch_attempt_id')
      .references(() => dispatchAttempts.id, { onDelete: 'restrict' })
      .notNull(),
    shipmentLineId: uuid('shipment_line_id')
      .references(() => shipmentLines.id, { onDelete: 'restrict' })
      .notNull(),
    sourceLocationId: uuid('source_location_id')
      .references(() => locations.id, { onDelete: 'restrict' })
      .notNull(),
    qty: integer('qty').notNull(),
    stockEventId: uuid('stock_event_id').references(() => stockEvents.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqDispatchAttemptSource: unique('uq_dispatch_attempt_sources_grain').on(
      t.dispatchAttemptId,
      t.shipmentLineId,
      t.sourceLocationId,
    ),
    uqDispatchAttemptStockEvent: uniqueIndex('uq_dispatch_attempt_sources_stock_event')
      .on(t.stockEventId)
      .where(sql`${t.stockEventId} IS NOT NULL`),
    idxDispatchAttemptSourceLine: index('idx_dispatch_attempt_sources_line').on(t.shipmentLineId),
    ckDispatchAttemptSourceQty: check('ck_dispatch_attempt_sources_qty_positive', sql`${t.qty} > 0`),
  }),
);

/*───────────────────────────
 * TABLES ONLY SCHEMA (for TypedDatabase)
 *──────────────────────────*/
export const wmsTables = {
  suppliers,
  supplierCategories,
  supplierCategoryMappings,
  holders,
  skus,
  skuSuppliers,
  skuBarcodes,
  skuImages,
  categories,
  skuCategories,
  skuManagers,
  skuLocationMovements,
  skuGroups,
  deliveryProfiles,
  warehouses,
  locationColumns,
  locationRacks,
  locations,
  stockJournals,
  stockEvents,
  stockLedgers,
  productMatchings,
  productVariantSkuLinks,
  productSellableQuantityProjections,
  salesOrders,
  salesOrderLines,
  orderEvents,
  businessLinks,
  salesOrderAmendments,
  salesOrderCancellations,
  mergeGroups,
  stockReservations,
  fulfillmentOrders,
  fulfillmentOrderCreationBacklogs,
  shipments,
  shipmentLines,
  shipmentTracking,
  returns,
  returnItems,
  salesVariantPolicies,
  settings,
  holidays,
  purchaseOrders,
  purchaseOrderLines,
  purchaseOrderCart,
  inboundReceipts,
  inboundReceiptLines,
  inboundPlans,
  inboundPlanItems,
  inboundWorkLogs,
  movementJobs,
  movementJobLines,
  movementWorkLogs,
  auditLogs,
  outboxEvents,
  inventoryIdempotencyRequests,

  // Stocktaking
  stocktakingSessions,
  stocktakingLines,
  stocktakingAdjustments,

  // FOI 기반 확장 스키마
  productSkuMappings,
  productSkuMappingItems,
  productSkuMappingSnapshots,
  fulfillmentOrderItems,
  inspectionIssues,
  outboundBatches,
  waybills,

  // Outbound V2 expand model
  fulfillmentCommandRequests,
  shipmentOperations,
  shipmentOperationMembers,
  outboundBatchWorkItems,
  pickingPlans,
  pickingPlanMembers,
  pickingSourceAllocations,
  batchInventorySessions,
  batchInventorySessionBalances,
  batchInventorySessionEvents,
  totes,
  shipmentToteAssignments,
  dispatchAttempts,
  dispatchAttemptSources,
} as const;

/*───────────────────────────
 * VIEWS ONLY SCHEMA
 *──────────────────────────*/
export const wmsViews = {
  stockSummary,
} as const;

/*───────────────────────────
 * RELATIONS
 *──────────────────────────*/

import { relations } from 'drizzle-orm';
import { TxFor } from '@app/db';

export const holdersRelations = relations(holders, ({ many }) => ({
  skus: many(skus),
  fulfillmentOrders: many(fulfillmentOrders),
}));

export const suppliersRelations = relations(suppliers, ({ many }) => ({
  purchaseOrders: many(purchaseOrders),
  skuSuppliers: many(skuSuppliers),
  supplierCategoryMappings: many(supplierCategoryMappings),
  skusAsLogisticsPartner: many(skus, {
    relationName: 'logisticsPartner',
  }),
}));

export const supplierCategoriesRelations = relations(supplierCategories, ({ many }) => ({
  supplierCategoryMappings: many(supplierCategoryMappings),
}));

export const supplierCategoryMappingsRelations = relations(supplierCategoryMappings, ({ one }) => ({
  supplier: one(suppliers, {
    fields: [supplierCategoryMappings.supplierId],
    references: [suppliers.id],
  }),
  category: one(supplierCategories, {
    fields: [supplierCategoryMappings.categoryId],
    references: [supplierCategories.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  skuCategories: many(skuCategories),
}));

export const deliveryProfilesRelations = relations(deliveryProfiles, ({ many }) => ({
  skus: many(skus),
  shipments: many(shipments),
}));

// SKU Relations (핵심)
export const skusRelations = relations(skus, ({ one, many }) => ({
  holder: one(holders, {
    fields: [skus.holderId],
    references: [holders.id],
  }),
  deliveryProfile: one(deliveryProfiles, {
    fields: [skus.deliveryProfileId],
    references: [deliveryProfiles.id],
  }),
  // Many-to-many relations
  skuSuppliers: many(skuSuppliers),
  skuCategories: many(skuCategories),
  skuBarcodes: many(skuBarcodes),
  images: many(skuImages),
  // Phase 2 Step 4: New relations
  managers: one(skuManagers),
  locationMovements: many(skuLocationMovements),
  group: one(skuGroups, {
    fields: [skus.groupId],
    references: [skuGroups.id],
  }),
  // Location references
  primaryLocation: one(locations, {
    fields: [skus.primaryLocationId],
    references: [locations.id],
    relationName: 'primaryLocation',
  }),
  secondaryLocation: one(locations, {
    fields: [skus.secondaryLocationId],
    references: [locations.id],
    relationName: 'secondaryLocation',
  }),
  logisticsPartner: one(suppliers, {
    fields: [skus.logisticsPartnerId],
    references: [suppliers.id],
    relationName: 'logisticsPartner',
  }),
  // Stock relations
  stockEvents: many(stockEvents),
  stockLedgers: many(stockLedgers),
  stockReservations: many(stockReservations),
  // Order relations
  fulfillmentOrderItems: many(fulfillmentOrderItems),
  // Purchase/Inbound relations
  purchaseOrderLines: many(purchaseOrderLines),
  purchaseOrderCart: many(purchaseOrderCart),
  inboundPlanItems: many(inboundPlanItems),
  inboundReceiptLines: many(inboundReceiptLines),
  // Movement relations
  movementJobLines: many(movementJobLines),
  // Matching relations
  productVariantSkuLinks: many(productVariantSkuLinks),
  // Mapping relations
  productSkuMappingItems: many(productSkuMappingItems),
  productSkuMappingSnapshots: many(productSkuMappingSnapshots),
}));

export const skuSuppliersRelations = relations(skuSuppliers, ({ one }) => ({
  sku: one(skus, {
    fields: [skuSuppliers.skuId],
    references: [skus.id],
  }),
  supplier: one(suppliers, {
    fields: [skuSuppliers.supplierId],
    references: [suppliers.id],
  }),
}));

export const skuCategoriesRelations = relations(skuCategories, ({ one }) => ({
  sku: one(skus, {
    fields: [skuCategories.skuId],
    references: [skus.id],
  }),
  category: one(categories, {
    fields: [skuCategories.categoryId],
    references: [categories.id],
  }),
}));

export const skuBarcodesRelations = relations(skuBarcodes, ({ one }) => ({
  sku: one(skus, {
    fields: [skuBarcodes.skuId],
    references: [skus.id],
  }),
}));

export const skuImagesRelations = relations(skuImages, ({ one }) => ({
  sku: one(skus, {
    fields: [skuImages.skuId],
    references: [skus.id],
  }),
}));

// ===== Phase 2 Step 4: New Table Relations =====

export const skuGroupsRelations = relations(skuGroups, ({ many }) => ({
  skus: many(skus),
}));

export const skuManagersRelations = relations(skuManagers, ({ one }) => ({
  sku: one(skus, {
    fields: [skuManagers.skuId],
    references: [skus.id],
  }),
}));

export const skuLocationMovementsRelations = relations(skuLocationMovements, ({ one }) => ({
  sku: one(skus, {
    fields: [skuLocationMovements.skuId],
    references: [skus.id],
  }),
  fromLocation: one(locations, {
    fields: [skuLocationMovements.fromLocationId],
    references: [locations.id],
    relationName: 'movementFrom',
  }),
  toLocation: one(locations, {
    fields: [skuLocationMovements.toLocationId],
    references: [locations.id],
    relationName: 'movementTo',
  }),
}));

// Warehouse & Location Relations
export const warehousesRelations = relations(warehouses, ({ many }) => ({
  locationColumns: many(locationColumns),
  locations: many(locations),
  stockEvents: many(stockEvents),
  stockLedgers: many(stockLedgers),
  stockReservations: many(stockReservations),
  fulfillmentOrders: many(fulfillmentOrders),
  outboundBatches: many(outboundBatches),
  movementJobs: many(movementJobs),
  inboundReceipts: many(inboundReceipts),
  inboundPlans: many(inboundPlans),
  inboundPlansAsDestination: many(inboundPlans, {
    relationName: 'destinationWarehouse',
  }),
  purchaseOrdersAsSource: many(purchaseOrders, {
    relationName: 'sourceWarehouse',
  }),
  purchaseOrdersAsDestination: many(purchaseOrders, {
    relationName: 'destinationWarehouse',
  }),
  productSkuMappings: many(productSkuMappings),
  productSkuMappingSnapshots: many(productSkuMappingSnapshots),
  settings: many(settings),
  shipments: many(shipments),
  totes: many(totes),
}));

export const locationColumnsRelations = relations(locationColumns, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [locationColumns.warehouseId],
    references: [warehouses.id],
  }),
  locationRacks: many(locationRacks),
}));

export const locationRacksRelations = relations(locationRacks, ({ one, many }) => ({
  column: one(locationColumns, {
    fields: [locationRacks.columnId],
    references: [locationColumns.id],
  }),
  locations: many(locations),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [locations.warehouseId],
    references: [warehouses.id],
  }),
  rack: one(locationRacks, {
    fields: [locations.rackId],
    references: [locationRacks.id],
  }),
  stockEvents: many(stockEvents),
  stockLedgers: many(stockLedgers),
  inboundReceipts: many(inboundReceipts),
  inboundReceiptLines: many(inboundReceiptLines),
  movementJobLines: many(movementJobLines),
  skusPrimary: many(skus, {
    relationName: 'primaryLocation',
  }),
  skusSecondary: many(skus, {
    relationName: 'secondaryLocation',
  }),
  skuMovementsFrom: many(skuLocationMovements, {
    relationName: 'movementFrom',
  }),
  skuMovementsTo: many(skuLocationMovements, {
    relationName: 'movementTo',
  }),
  pickingSourceAllocations: many(pickingSourceAllocations),
  batchInventorySessionBalances: many(batchInventorySessionBalances),
  batchInventorySessionEventsFrom: many(batchInventorySessionEvents, { relationName: 'sessionEventFromSource' }),
  batchInventorySessionEventsTo: many(batchInventorySessionEvents, { relationName: 'sessionEventToSource' }),
  dispatchAttemptSources: many(dispatchAttemptSources),
}));

// Stock Relations
export const stockJournalsRelations = relations(stockJournals, ({ many }) => ({
  stockEvents: many(stockEvents),
  movementJobs: many(movementJobs),
  inboundReceipts: many(inboundReceipts),
  dispatchAttempts: many(dispatchAttempts, { relationName: 'dispatchJournal' }),
  dispatchAttemptReversals: many(dispatchAttempts, { relationName: 'reversalJournal' }),
}));

export const stockEventsRelations = relations(stockEvents, ({ one }) => ({
  journal: one(stockJournals, {
    fields: [stockEvents.journalId],
    references: [stockJournals.id],
  }),
  sku: one(skus, {
    fields: [stockEvents.skuId],
    references: [skus.id],
  }),
  fromWarehouse: one(warehouses, {
    fields: [stockEvents.fromWarehouseId],
    references: [warehouses.id],
  }),
  toWarehouse: one(warehouses, {
    fields: [stockEvents.toWarehouseId],
    references: [warehouses.id],
  }),
  fromLocation: one(locations, {
    fields: [stockEvents.fromLocationId],
    references: [locations.id],
  }),
  toLocation: one(locations, {
    fields: [stockEvents.toLocationId],
    references: [locations.id],
  }),
  dispatchAttemptSource: one(dispatchAttemptSources),
}));

export const stockLedgersRelations = relations(stockLedgers, ({ one }) => ({
  sku: one(skus, {
    fields: [stockLedgers.skuId],
    references: [skus.id],
  }),
  warehouse: one(warehouses, {
    fields: [stockLedgers.warehouseId],
    references: [warehouses.id],
  }),
  location: one(locations, {
    fields: [stockLedgers.locationId],
    references: [locations.id],
  }),
}));

export const stockReservationsRelations = relations(stockReservations, ({ one }) => ({
  sku: one(skus, {
    fields: [stockReservations.skuId],
    references: [skus.id],
  }),
  warehouse: one(warehouses, {
    fields: [stockReservations.warehouseId],
    references: [warehouses.id],
  }),
  fulfillmentOrderItem: one(fulfillmentOrderItems, {
    fields: [stockReservations.fulfillmentOrderItemId],
    references: [fulfillmentOrderItems.id],
  }),
  shipmentLine: one(shipmentLines, {
    fields: [stockReservations.shipmentLineId],
    references: [shipmentLines.id],
  }),
}));

// Product Matching Relations
export const productMatchingsRelations = relations(productMatchings, ({ one, many }) => ({
  productVariantSkuLinks: many(productVariantSkuLinks),
  salesOrderLines: many(salesOrderLines),
}));

export const productVariantSkuLinksRelations = relations(productVariantSkuLinks, ({ one }) => ({
  productMatching: one(productMatchings, {
    fields: [productVariantSkuLinks.productMatchingId],
    references: [productMatchings.id],
  }),
  sku: one(skus, {
    fields: [productVariantSkuLinks.skuId],
    references: [skus.id],
  }),
}));

// Sales Order Relations
export const salesOrdersRelations = relations(salesOrders, ({ one, many }) => ({
  lines: many(salesOrderLines),
  fulfillmentOrder: one(fulfillmentOrders),
  // V1 compatibility relation; remove when all readers use the one-to-one relation above (Task 25).
  fulfillmentOrders: many(fulfillmentOrders),
  fulfillmentOrderCreationBacklogs: many(fulfillmentOrderCreationBacklogs),
  orderEvents: many(orderEvents),
  cancellations: many(salesOrderCancellations),
  returns: many(returns),
}));

export const salesOrderLinesRelations = relations(salesOrderLines, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [salesOrderLines.salesOrderId],
    references: [salesOrders.id],
  }),
  productMatching: one(productMatchings, {
    fields: [salesOrderLines.productMatchingId],
    references: [productMatchings.id],
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(salesOrders, {
    fields: [orderEvents.orderId],
    references: [salesOrders.id],
  }),
}));

export const salesOrderCancellationsRelations = relations(salesOrderCancellations, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [salesOrderCancellations.salesOrderId],
    references: [salesOrders.id],
  }),
}));

// Fulfillment Order Relations
export const fulfillmentOrdersRelations = relations(fulfillmentOrders, ({ one, many }) => ({
  salesOrder: one(salesOrders, {
    fields: [fulfillmentOrders.salesOrderId],
    references: [salesOrders.id],
  }),
  warehouse: one(warehouses, {
    fields: [fulfillmentOrders.warehouseId],
    references: [warehouses.id],
  }),
  owner: one(holders, {
    fields: [fulfillmentOrders.ownerId],
    references: [holders.id],
  }),
  items: many(fulfillmentOrderItems),
  creationBacklogs: many(fulfillmentOrderCreationBacklogs),
  shipments: many(shipments),
}));

export const fulfillmentOrderCreationBacklogsRelations = relations(fulfillmentOrderCreationBacklogs, ({ one }) => ({
  salesOrder: one(salesOrders, {
    fields: [fulfillmentOrderCreationBacklogs.salesOrderId],
    references: [salesOrders.id],
  }),
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [fulfillmentOrderCreationBacklogs.fulfillmentOrderId],
    references: [fulfillmentOrders.id],
  }),
}));

export const fulfillmentOrderItemsRelations = relations(fulfillmentOrderItems, ({ one, many }) => ({
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [fulfillmentOrderItems.fulfillmentOrderId],
    references: [fulfillmentOrders.id],
  }),
  sku: one(skus, {
    fields: [fulfillmentOrderItems.skuId],
    references: [skus.id],
  }),
  mappingSnapshot: one(productSkuMappingSnapshots, {
    fields: [fulfillmentOrderItems.mappingSnapshotId],
    references: [productSkuMappingSnapshots.id],
  }),
  stockReservations: many(stockReservations),
  shipmentLines: many(shipmentLines),
}));

export const outboundBatchesRelations = relations(outboundBatches, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [outboundBatches.warehouseId],
    references: [warehouses.id],
  }),
  workItems: many(outboundBatchWorkItems),
  pickingPlans: many(pickingPlans),
  inventorySessions: many(batchInventorySessions),
}));

// Shipment Relations
export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [shipments.openedForFulfillmentOrderId],
    references: [fulfillmentOrders.id],
  }),
  warehouse: one(warehouses, {
    fields: [shipments.warehouseId],
    references: [warehouses.id],
  }),
  shippingProfile: one(deliveryProfiles, {
    fields: [shipments.shippingProfileId],
    references: [deliveryProfiles.id],
  }),
  lines: many(shipmentLines),
  shipmentTracking: many(shipmentTracking),
  returns: many(returns),
  operationMembers: many(shipmentOperationMembers),
  workItems: many(outboundBatchWorkItems),
  pickingPlanMembers: many(pickingPlanMembers),
  toteAssignments: many(shipmentToteAssignments),
  dispatchAttempts: many(dispatchAttempts),
}));

export const shipmentLinesRelations = relations(shipmentLines, ({ one, many }) => ({
  shipment: one(shipments, {
    fields: [shipmentLines.shipmentId],
    references: [shipments.id],
  }),
  fulfillmentOrderItem: one(fulfillmentOrderItems, {
    fields: [shipmentLines.fulfillmentOrderItemId],
    references: [fulfillmentOrderItems.id],
  }),
  sku: one(skus, {
    fields: [shipmentLines.skuId],
    references: [skus.id],
  }),
  createdFromLine: one(shipmentLines, {
    fields: [shipmentLines.createdFromLineId],
    references: [shipmentLines.id],
    relationName: 'shipmentLineLineage',
  }),
  splitLines: many(shipmentLines, { relationName: 'shipmentLineLineage' }),
  reservations: many(stockReservations),
  pickingAllocations: many(pickingSourceAllocations),
  sessionBalances: many(batchInventorySessionBalances),
  sessionEventsFrom: many(batchInventorySessionEvents, { relationName: 'sessionEventFromLine' }),
  sessionEventsTo: many(batchInventorySessionEvents, { relationName: 'sessionEventToLine' }),
  dispatchSources: many(dispatchAttemptSources),
}));

export const shipmentTrackingRelations = relations(shipmentTracking, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentTracking.shipmentId],
    references: [shipments.id],
  }),
  dispatchAttempt: one(dispatchAttempts, {
    fields: [shipmentTracking.dispatchAttemptId],
    references: [dispatchAttempts.id],
  }),
}));

export const returnsRelations = relations(returns, ({ one }) => ({
  order: one(salesOrders, {
    fields: [returns.orderId],
    references: [salesOrders.id],
  }),
  shipment: one(shipments, {
    fields: [returns.shipmentId],
    references: [shipments.id],
  }),
}));

export const fulfillmentCommandRequestsRelations = relations(fulfillmentCommandRequests, ({ one }) => ({
  attempt: one(dispatchAttempts, {
    fields: [fulfillmentCommandRequests.attemptId],
    references: [dispatchAttempts.id],
  }),
}));

export const shipmentOperationsRelations = relations(shipmentOperations, ({ many }) => ({
  members: many(shipmentOperationMembers),
  waitingWorkItems: many(outboundBatchWorkItems),
}));

export const shipmentOperationMembersRelations = relations(shipmentOperationMembers, ({ one }) => ({
  operation: one(shipmentOperations, {
    fields: [shipmentOperationMembers.operationId],
    references: [shipmentOperations.id],
  }),
  shipment: one(shipments, {
    fields: [shipmentOperationMembers.shipmentId],
    references: [shipments.id],
  }),
}));

export const outboundBatchWorkItemsRelations = relations(outboundBatchWorkItems, ({ one }) => ({
  batch: one(outboundBatches, {
    fields: [outboundBatchWorkItems.batchId],
    references: [outboundBatches.id],
  }),
  shipment: one(shipments, {
    fields: [outboundBatchWorkItems.shipmentId],
    references: [shipments.id],
  }),
  waitingOperation: one(shipmentOperations, {
    fields: [outboundBatchWorkItems.waitingOperationId],
    references: [shipmentOperations.id],
  }),
}));

export const pickingPlansRelations = relations(pickingPlans, ({ one, many }) => ({
  batch: one(outboundBatches, {
    fields: [pickingPlans.batchId],
    references: [outboundBatches.id],
  }),
  members: many(pickingPlanMembers),
  allocations: many(pickingSourceAllocations),
}));

export const pickingPlanMembersRelations = relations(pickingPlanMembers, ({ one }) => ({
  plan: one(pickingPlans, {
    fields: [pickingPlanMembers.planId],
    references: [pickingPlans.id],
  }),
  shipment: one(shipments, {
    fields: [pickingPlanMembers.shipmentId],
    references: [shipments.id],
  }),
}));

export const pickingSourceAllocationsRelations = relations(pickingSourceAllocations, ({ one }) => ({
  plan: one(pickingPlans, {
    fields: [pickingSourceAllocations.planId],
    references: [pickingPlans.id],
  }),
  shipmentLine: one(shipmentLines, {
    fields: [pickingSourceAllocations.shipmentLineId],
    references: [shipmentLines.id],
  }),
  sourceLocation: one(locations, {
    fields: [pickingSourceAllocations.sourceLocationId],
    references: [locations.id],
  }),
}));

export const batchInventorySessionsRelations = relations(batchInventorySessions, ({ one, many }) => ({
  batch: one(outboundBatches, {
    fields: [batchInventorySessions.batchId],
    references: [outboundBatches.id],
  }),
  balances: many(batchInventorySessionBalances),
  events: many(batchInventorySessionEvents),
}));

export const batchInventorySessionBalancesRelations = relations(batchInventorySessionBalances, ({ one }) => ({
  session: one(batchInventorySessions, {
    fields: [batchInventorySessionBalances.sessionId],
    references: [batchInventorySessions.id],
  }),
  sku: one(skus, {
    fields: [batchInventorySessionBalances.skuId],
    references: [skus.id],
  }),
  sourceLocation: one(locations, {
    fields: [batchInventorySessionBalances.sourceLocationId],
    references: [locations.id],
  }),
  shipmentLine: one(shipmentLines, {
    fields: [batchInventorySessionBalances.shipmentLineId],
    references: [shipmentLines.id],
  }),
}));

export const batchInventorySessionEventsRelations = relations(batchInventorySessionEvents, ({ one }) => ({
  session: one(batchInventorySessions, {
    fields: [batchInventorySessionEvents.sessionId],
    references: [batchInventorySessions.id],
  }),
  sku: one(skus, {
    fields: [batchInventorySessionEvents.skuId],
    references: [skus.id],
  }),
  fromSourceLocation: one(locations, {
    fields: [batchInventorySessionEvents.fromSourceLocationId],
    references: [locations.id],
    relationName: 'sessionEventFromSource',
  }),
  toSourceLocation: one(locations, {
    fields: [batchInventorySessionEvents.toSourceLocationId],
    references: [locations.id],
    relationName: 'sessionEventToSource',
  }),
  fromShipmentLine: one(shipmentLines, {
    fields: [batchInventorySessionEvents.fromShipmentLineId],
    references: [shipmentLines.id],
    relationName: 'sessionEventFromLine',
  }),
  toShipmentLine: one(shipmentLines, {
    fields: [batchInventorySessionEvents.toShipmentLineId],
    references: [shipmentLines.id],
    relationName: 'sessionEventToLine',
  }),
}));

export const totesRelations = relations(totes, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [totes.warehouseId],
    references: [warehouses.id],
  }),
  assignments: many(shipmentToteAssignments),
}));

export const shipmentToteAssignmentsRelations = relations(shipmentToteAssignments, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentToteAssignments.shipmentId],
    references: [shipments.id],
  }),
  tote: one(totes, {
    fields: [shipmentToteAssignments.toteId],
    references: [totes.id],
  }),
}));

export const dispatchAttemptsRelations = relations(dispatchAttempts, ({ one, many }) => ({
  shipment: one(shipments, {
    fields: [dispatchAttempts.shipmentId],
    references: [shipments.id],
  }),
  stockJournal: one(stockJournals, {
    fields: [dispatchAttempts.stockJournalId],
    references: [stockJournals.id],
    relationName: 'dispatchJournal',
  }),
  reversalJournal: one(stockJournals, {
    fields: [dispatchAttempts.reversalJournalId],
    references: [stockJournals.id],
    relationName: 'reversalJournal',
  }),
  tracking: many(shipmentTracking),
  sources: many(dispatchAttemptSources),
  commandRequests: many(fulfillmentCommandRequests),
}));

export const dispatchAttemptSourcesRelations = relations(dispatchAttemptSources, ({ one }) => ({
  dispatchAttempt: one(dispatchAttempts, {
    fields: [dispatchAttemptSources.dispatchAttemptId],
    references: [dispatchAttempts.id],
  }),
  shipmentLine: one(shipmentLines, {
    fields: [dispatchAttemptSources.shipmentLineId],
    references: [shipmentLines.id],
  }),
  sourceLocation: one(locations, {
    fields: [dispatchAttemptSources.sourceLocationId],
    references: [locations.id],
  }),
  stockEvent: one(stockEvents, {
    fields: [dispatchAttemptSources.stockEventId],
    references: [stockEvents.id],
  }),
}));

// Purchase Order Relations
export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
  lines: many(purchaseOrderLines),
  supplier: one(suppliers, {
    fields: [purchaseOrders.supplierId],
    references: [suppliers.id],
  }),
  sourceWarehouse: one(warehouses, {
    fields: [purchaseOrders.sourceWarehouseId],
    references: [warehouses.id],
    relationName: 'sourceWarehouse',
  }),
  destinationWarehouse: one(warehouses, {
    fields: [purchaseOrders.destinationWarehouseId],
    references: [warehouses.id],
    relationName: 'destinationWarehouse',
  }),
  inboundPlans: many(inboundPlans),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
  purchaseOrder: one(purchaseOrders, {
    fields: [purchaseOrderLines.poId],
    references: [purchaseOrders.id],
  }),
  sku: one(skus, {
    fields: [purchaseOrderLines.skuId],
    references: [skus.id],
  }),
}));

export const purchaseOrderCartRelations = relations(purchaseOrderCart, ({ one }) => ({
  sku: one(skus, {
    fields: [purchaseOrderCart.skuId],
    references: [skus.id],
  }),
}));

// Inbound Relations
export const inboundReceiptsRelations = relations(inboundReceipts, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [inboundReceipts.warehouseId],
    references: [warehouses.id],
  }),
  location: one(locations, {
    fields: [inboundReceipts.locationId],
    references: [locations.id],
  }),
  journal: one(stockJournals, {
    fields: [inboundReceipts.journalId],
    references: [stockJournals.id],
  }),
  lines: many(inboundReceiptLines),
}));

export const inboundPlansRelations = relations(inboundPlans, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [inboundPlans.warehouseId],
    references: [warehouses.id],
  }),
  destinationWarehouse: one(warehouses, {
    fields: [inboundPlans.destinationWarehouseId],
    references: [warehouses.id],
    relationName: 'destinationWarehouse',
  }),
  linkedPurchaseOrder: one(purchaseOrders, {
    fields: [inboundPlans.linkedPurchaseOrderId],
    references: [purchaseOrders.id],
  }),
  parentPlan: one(inboundPlans, {
    fields: [inboundPlans.parentPlanId],
    references: [inboundPlans.id],
    relationName: 'parentChildPlans',
  }),
  items: many(inboundPlanItems),
}));

export const inboundPlanItemsRelations = relations(inboundPlanItems, ({ one, many }) => ({
  plan: one(inboundPlans, {
    fields: [inboundPlanItems.planId],
    references: [inboundPlans.id],
  }),
  sku: one(skus, {
    fields: [inboundPlanItems.skuId],
    references: [skus.id],
  }),
  receiptLines: many(inboundReceiptLines),
}));

export const inboundReceiptLinesRelations = relations(inboundReceiptLines, ({ one }) => ({
  receipt: one(inboundReceipts, {
    fields: [inboundReceiptLines.receiptId],
    references: [inboundReceipts.id],
  }),
  sku: one(skus, {
    fields: [inboundReceiptLines.skuId],
    references: [skus.id],
  }),
  originLocation: one(locations, {
    fields: [inboundReceiptLines.originLocationId],
    references: [locations.id],
  }),
  stockEvent: one(stockEvents, {
    fields: [inboundReceiptLines.eventId],
    references: [stockEvents.id],
  }),
  planItem: one(inboundPlanItems, {
    fields: [inboundReceiptLines.planItemId],
    references: [inboundPlanItems.id],
  }),
}));

// Movement Relations
export const movementJobsRelations = relations(movementJobs, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [movementJobs.warehouseId],
    references: [warehouses.id],
  }),
  journal: one(stockJournals, {
    fields: [movementJobs.journalId],
    references: [stockJournals.id],
  }),
  lines: many(movementJobLines),
}));

export const movementJobLinesRelations = relations(movementJobLines, ({ one }) => ({
  job: one(movementJobs, {
    fields: [movementJobLines.jobId],
    references: [movementJobs.id],
  }),
  sku: one(skus, {
    fields: [movementJobLines.skuId],
    references: [skus.id],
  }),
  fromLocation: one(locations, {
    fields: [movementJobLines.fromLocationId],
    references: [locations.id],
  }),
  toLocation: one(locations, {
    fields: [movementJobLines.toLocationId],
    references: [locations.id],
  }),
  event: one(stockEvents, {
    fields: [movementJobLines.eventId],
    references: [stockEvents.id],
  }),
}));

// Product-SKU Mapping Relations
export const productSkuMappingsRelations = relations(productSkuMappings, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [productSkuMappings.warehouseId],
    references: [warehouses.id],
  }),
  items: many(productSkuMappingItems),
}));

export const productSkuMappingItemsRelations = relations(productSkuMappingItems, ({ one }) => ({
  mapping: one(productSkuMappings, {
    fields: [productSkuMappingItems.mappingId],
    references: [productSkuMappings.id],
  }),
  sku: one(skus, {
    fields: [productSkuMappingItems.skuId],
    references: [skus.id],
  }),
}));

export const productSkuMappingSnapshotsRelations = relations(productSkuMappingSnapshots, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [productSkuMappingSnapshots.warehouseId],
    references: [warehouses.id],
  }),
  sku: one(skus, {
    fields: [productSkuMappingSnapshots.skuId],
    references: [skus.id],
  }),
  mapping: one(productSkuMappings, {
    fields: [productSkuMappingSnapshots.mappingId],
    references: [productSkuMappings.id],
  }),
  fulfillmentOrderItems: many(fulfillmentOrderItems),
}));

// Settings Relations
export const settingsRelations = relations(settings, ({ one }) => ({
  warehouse: one(warehouses, {
    fields: [settings.warehouseId],
    references: [warehouses.id],
  }),
}));

// Stocktaking Relations
export const stocktakingSessionsRelations = relations(stocktakingSessions, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [stocktakingSessions.warehouseId],
    references: [warehouses.id],
  }),
  lines: many(stocktakingLines),
  adjustments: many(stocktakingAdjustments),
}));

export const stocktakingLinesRelations = relations(stocktakingLines, ({ one }) => ({
  session: one(stocktakingSessions, {
    fields: [stocktakingLines.sessionId],
    references: [stocktakingSessions.id],
  }),
  sku: one(skus, {
    fields: [stocktakingLines.skuId],
    references: [skus.id],
  }),
  location: one(locations, {
    fields: [stocktakingLines.locationId],
    references: [locations.id],
  }),
}));

export const stocktakingAdjustmentsRelations = relations(stocktakingAdjustments, ({ one }) => ({
  session: one(stocktakingSessions, {
    fields: [stocktakingAdjustments.sessionId],
    references: [stocktakingSessions.id],
  }),
  line: one(stocktakingLines, {
    fields: [stocktakingAdjustments.lineId],
    references: [stocktakingLines.id],
  }),
  stockEvent: one(stockEvents, {
    fields: [stocktakingAdjustments.stockEventId],
    references: [stockEvents.id],
  }),
}));

export const wmsRelations = {
  holdersRelations,
  suppliersRelations,
  supplierCategoriesRelations,
  supplierCategoryMappingsRelations,
  categoriesRelations,
  deliveryProfilesRelations,

  // SKU Relations
  skusRelations,
  skuGroupsRelations,
  skuManagersRelations,
  skuLocationMovementsRelations,
  skuSuppliersRelations,
  skuCategoriesRelations,
  skuBarcodesRelations,
  skuImagesRelations,

  // Warehouse & Location Relations
  warehousesRelations,
  locationColumnsRelations,
  locationRacksRelations,
  locationsRelations,

  // Stock Relations
  stockJournalsRelations,
  stockEventsRelations,
  stockLedgersRelations,
  stockReservationsRelations,

  // Product Matching Relations
  productMatchingsRelations,
  productVariantSkuLinksRelations,

  // Sales Order Relations
  salesOrdersRelations,
  salesOrderLinesRelations,
  orderEventsRelations,
  salesOrderCancellationsRelations,

  // Fulfillment Order Relations
  fulfillmentOrdersRelations,
  fulfillmentOrderCreationBacklogsRelations,
  fulfillmentOrderItemsRelations,

  // Outbound Relations
  outboundBatchesRelations,

  // Shipment Relations
  shipmentsRelations,
  shipmentLinesRelations,
  shipmentTrackingRelations,
  returnsRelations,

  // Outbound V2 Relations
  fulfillmentCommandRequestsRelations,
  shipmentOperationsRelations,
  shipmentOperationMembersRelations,
  outboundBatchWorkItemsRelations,
  pickingPlansRelations,
  pickingPlanMembersRelations,
  pickingSourceAllocationsRelations,
  batchInventorySessionsRelations,
  batchInventorySessionBalancesRelations,
  batchInventorySessionEventsRelations,
  totesRelations,
  shipmentToteAssignmentsRelations,
  dispatchAttemptsRelations,
  dispatchAttemptSourcesRelations,

  // Purchase Order Relations
  purchaseOrdersRelations,
  purchaseOrderLinesRelations,
  purchaseOrderCartRelations,

  // Inbound Relations
  inboundReceiptsRelations,
  inboundPlansRelations,
  inboundPlanItemsRelations,
  inboundReceiptLinesRelations,

  // Movement Relations
  movementJobsRelations,
  movementJobLinesRelations,

  // Product-SKU Mapping Relations
  productSkuMappingsRelations,
  productSkuMappingItemsRelations,
  productSkuMappingSnapshotsRelations,

  // Settings Relations
  settingsRelations,

  // Stocktaking Relations
  stocktakingSessionsRelations,
  stocktakingLinesRelations,
  stocktakingAdjustmentsRelations,
} as const;

// Complete schema for queries (includes both tables and views)
export const wmsSchema = {
  ...wmsTables,
  ...wmsViews,
  ...wmsRelations,
  ...authorizationSchema,
} as const;

export type DbTx = TxFor<typeof wmsSchema>;

/*───────────────────────────
 * TABLE TYPES (Select/Insert)
 *──────────────────────────*/

// Supplier Types
export type Supplier = InferSelectModel<typeof suppliers>;
export type NewSupplier = InferInsertModel<typeof suppliers>;

export type SupplierCategory = InferSelectModel<typeof supplierCategories>;
export type NewSupplierCategory = InferInsertModel<typeof supplierCategories>;

export type SupplierCategoryMapping = InferSelectModel<typeof supplierCategoryMappings>;
export type NewSupplierCategoryMapping = InferInsertModel<typeof supplierCategoryMappings>;

// Holder Types
export type Holder = InferSelectModel<typeof holders>;
export type NewHolder = InferInsertModel<typeof holders>;

// SKU Types
export type Sku = InferSelectModel<typeof skus>;
export type NewSku = InferInsertModel<typeof skus>;

export type SkuSupplier = InferSelectModel<typeof skuSuppliers>;
export type NewSkuSupplier = InferInsertModel<typeof skuSuppliers>;

export type SkuBarcode = InferSelectModel<typeof skuBarcodes>;
export type NewSkuBarcode = InferInsertModel<typeof skuBarcodes>;

export type SkuImage = InferSelectModel<typeof skuImages>;
export type NewSkuImage = InferInsertModel<typeof skuImages>;

export type Category = InferSelectModel<typeof categories>;
export type NewCategory = InferInsertModel<typeof categories>;

export type SkuCategory = InferSelectModel<typeof skuCategories>;
export type NewSkuCategory = InferInsertModel<typeof skuCategories>;

export type SkuManager = InferSelectModel<typeof skuManagers>;
export type NewSkuManager = InferInsertModel<typeof skuManagers>;

export type SkuLocationMovement = InferSelectModel<typeof skuLocationMovements>;
export type NewSkuLocationMovement = InferInsertModel<typeof skuLocationMovements>;

export type SkuGroup = InferSelectModel<typeof skuGroups>;
export type NewSkuGroup = InferInsertModel<typeof skuGroups>;

export type DeliveryProfile = InferSelectModel<typeof deliveryProfiles>;
export type NewDeliveryProfile = InferInsertModel<typeof deliveryProfiles>;

// Warehouse & Location Types
export type Warehouse = InferSelectModel<typeof warehouses>;
export type NewWarehouse = InferInsertModel<typeof warehouses>;

export type LocationColumn = InferSelectModel<typeof locationColumns>;
export type NewLocationColumn = InferInsertModel<typeof locationColumns>;

export type LocationRack = InferSelectModel<typeof locationRacks>;
export type NewLocationRack = InferInsertModel<typeof locationRacks>;

export type Location = InferSelectModel<typeof locations>;
export type NewLocation = InferInsertModel<typeof locations>;

// Stock Types
export type StockJournal = InferSelectModel<typeof stockJournals>;
export type NewStockJournal = InferInsertModel<typeof stockJournals>;

export type StockEvent = InferSelectModel<typeof stockEvents>;
export type NewStockEvent = InferInsertModel<typeof stockEvents>;

export type StockLedger = InferSelectModel<typeof stockLedgers>;
export type NewStockLedger = InferInsertModel<typeof stockLedgers>;

export type StockSummary = InferSelectViewModel<typeof stockSummary>;

// Product Matching Types
export type ProductMatching = InferSelectModel<typeof productMatchings>;
export type NewProductMatching = InferInsertModel<typeof productMatchings>;

export type ProductVariantSkuLink = InferSelectModel<typeof productVariantSkuLinks>;
export type NewProductVariantSkuLink = InferInsertModel<typeof productVariantSkuLinks>;

export type ProductSellableQuantityProjection = InferSelectModel<typeof productSellableQuantityProjections>;
export type NewProductSellableQuantityProjection = InferInsertModel<typeof productSellableQuantityProjections>;

// Sales Order Types
export type SalesOrder = InferSelectModel<typeof salesOrders>;
export type NewSalesOrder = InferInsertModel<typeof salesOrders>;

export type SalesOrderLine = InferSelectModel<typeof salesOrderLines>;
export type NewSalesOrderLine = InferInsertModel<typeof salesOrderLines>;

export type OrderEvent = InferSelectModel<typeof orderEvents>;
export type NewOrderEvent = InferInsertModel<typeof orderEvents>;

export type BusinessLink = InferSelectModel<typeof businessLinks>;
export type NewBusinessLink = InferInsertModel<typeof businessLinks>;

export type SalesOrderAmendment = InferSelectModel<typeof salesOrderAmendments>;
export type NewSalesOrderAmendment = InferInsertModel<typeof salesOrderAmendments>;

export type SalesOrderCancellation = InferSelectModel<typeof salesOrderCancellations>;
export type NewSalesOrderCancellation = InferInsertModel<typeof salesOrderCancellations>;

export type MergeGroup = InferSelectModel<typeof mergeGroups>;
export type NewMergeGroup = InferInsertModel<typeof mergeGroups>;

// Reservation Types
export type StockReservation = InferSelectModel<typeof stockReservations>;
export type NewStockReservation = InferInsertModel<typeof stockReservations>;

// Fulfillment Types
export type FulfillmentOrder = InferSelectModel<typeof fulfillmentOrders>;
export type NewFulfillmentOrder = InferInsertModel<typeof fulfillmentOrders>;

export type FulfillmentOrderCreationBacklog = InferSelectModel<typeof fulfillmentOrderCreationBacklogs>;
export type NewFulfillmentOrderCreationBacklog = InferInsertModel<typeof fulfillmentOrderCreationBacklogs>;

export type FulfillmentOrderItem = InferSelectModel<typeof fulfillmentOrderItems>;
export type NewFulfillmentOrderItem = InferInsertModel<typeof fulfillmentOrderItems>;

export type OutboundBatch = InferSelectModel<typeof outboundBatches>;
export type NewOutboundBatch = InferInsertModel<typeof outboundBatches>;

// Shipment Types
export type Shipment = InferSelectModel<typeof shipments>;
export type NewShipment = InferInsertModel<typeof shipments>;

export type ShipmentLine = InferSelectModel<typeof shipmentLines>;
export type NewShipmentLine = InferInsertModel<typeof shipmentLines>;

export type ShipmentTracking = InferSelectModel<typeof shipmentTracking>;
export type NewShipmentTracking = InferInsertModel<typeof shipmentTracking>;

// Return Types
export type Return = InferSelectModel<typeof returns>;
export type NewReturn = InferInsertModel<typeof returns>;

export type ReturnItem = InferSelectModel<typeof returnItems>;
export type NewReturnItem = InferInsertModel<typeof returnItems>;

// Policy & Settings Types
export type SalesVariantPolicy = InferSelectModel<typeof salesVariantPolicies>;
export type NewSalesVariantPolicy = InferInsertModel<typeof salesVariantPolicies>;

export type Setting = InferSelectModel<typeof settings>;
export type NewSetting = InferInsertModel<typeof settings>;

export type Holiday = InferSelectModel<typeof holidays>;
export type NewHoliday = InferInsertModel<typeof holidays>;

// Purchase Order Types
export type PurchaseOrder = InferSelectModel<typeof purchaseOrders>;
export type NewPurchaseOrder = InferInsertModel<typeof purchaseOrders>;

export type PurchaseOrderLine = InferSelectModel<typeof purchaseOrderLines>;
export type NewPurchaseOrderLine = InferInsertModel<typeof purchaseOrderLines>;

export type PurchaseOrderCart = InferSelectModel<typeof purchaseOrderCart>;
export type NewPurchaseOrderCart = InferInsertModel<typeof purchaseOrderCart>;

// Inbound Types
export type InboundReceipt = InferSelectModel<typeof inboundReceipts>;
export type NewInboundReceipt = InferInsertModel<typeof inboundReceipts>;

export type InboundReceiptLine = InferSelectModel<typeof inboundReceiptLines>;
export type NewInboundReceiptLine = InferInsertModel<typeof inboundReceiptLines>;

export type InboundPlan = InferSelectModel<typeof inboundPlans>;
export type NewInboundPlan = InferInsertModel<typeof inboundPlans>;

export type InboundPlanItem = InferSelectModel<typeof inboundPlanItems>;
export type NewInboundPlanItem = InferInsertModel<typeof inboundPlanItems>;

export type InboundWorkLog = InferSelectModel<typeof inboundWorkLogs>;
export type NewInboundWorkLog = InferInsertModel<typeof inboundWorkLogs>;

// Movement Types
export type MovementJob = InferSelectModel<typeof movementJobs>;
export type NewMovementJob = InferInsertModel<typeof movementJobs>;

export type MovementJobLine = InferSelectModel<typeof movementJobLines>;
export type NewMovementJobLine = InferInsertModel<typeof movementJobLines>;

export type MovementWorkLog = InferSelectModel<typeof movementWorkLogs>;
export type NewMovementWorkLog = InferInsertModel<typeof movementWorkLogs>;

// Audit Types
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type NewAuditLog = InferInsertModel<typeof auditLogs>;

export type OutboxEvent = InferSelectModel<typeof outboxEvents>;
export type NewOutboxEvent = InferInsertModel<typeof outboxEvents>;

// Stocktaking Types
export type StocktakingSession = InferSelectModel<typeof stocktakingSessions>;
export type NewStocktakingSession = InferInsertModel<typeof stocktakingSessions>;

export type StocktakingLine = InferSelectModel<typeof stocktakingLines>;
export type NewStocktakingLine = InferInsertModel<typeof stocktakingLines>;

export type StocktakingAdjustment = InferSelectModel<typeof stocktakingAdjustments>;
export type NewStocktakingAdjustment = InferInsertModel<typeof stocktakingAdjustments>;

// Product-SKU Mapping Types
export type ProductSkuMapping = InferSelectModel<typeof productSkuMappings>;
export type NewProductSkuMapping = InferInsertModel<typeof productSkuMappings>;

export type ProductSkuMappingItem = InferSelectModel<typeof productSkuMappingItems>;
export type NewProductSkuMappingItem = InferInsertModel<typeof productSkuMappingItems>;

export type ProductSkuMappingSnapshot = InferSelectModel<typeof productSkuMappingSnapshots>;
export type NewProductSkuMappingSnapshot = InferInsertModel<typeof productSkuMappingSnapshots>;

// Waybill Types
export type Waybill = InferSelectModel<typeof waybills>;
export type NewWaybill = InferInsertModel<typeof waybills>;

// Outbound V2 expand model types
export type FulfillmentCommandRequest = InferSelectModel<typeof fulfillmentCommandRequests>;
export type NewFulfillmentCommandRequest = InferInsertModel<typeof fulfillmentCommandRequests>;
export type ShipmentOperation = InferSelectModel<typeof shipmentOperations>;
export type NewShipmentOperation = InferInsertModel<typeof shipmentOperations>;
export type ShipmentOperationMember = InferSelectModel<typeof shipmentOperationMembers>;
export type NewShipmentOperationMember = InferInsertModel<typeof shipmentOperationMembers>;
export type OutboundBatchWorkItem = InferSelectModel<typeof outboundBatchWorkItems>;
export type NewOutboundBatchWorkItem = InferInsertModel<typeof outboundBatchWorkItems>;
export type PickingPlan = InferSelectModel<typeof pickingPlans>;
export type NewPickingPlan = InferInsertModel<typeof pickingPlans>;
export type PickingPlanMember = InferSelectModel<typeof pickingPlanMembers>;
export type NewPickingPlanMember = InferInsertModel<typeof pickingPlanMembers>;
export type PickingSourceAllocation = InferSelectModel<typeof pickingSourceAllocations>;
export type NewPickingSourceAllocation = InferInsertModel<typeof pickingSourceAllocations>;
export type BatchInventorySession = InferSelectModel<typeof batchInventorySessions>;
export type NewBatchInventorySession = InferInsertModel<typeof batchInventorySessions>;
export type BatchInventorySessionBalance = InferSelectModel<typeof batchInventorySessionBalances>;
export type NewBatchInventorySessionBalance = InferInsertModel<typeof batchInventorySessionBalances>;
export type BatchInventorySessionEvent = InferSelectModel<typeof batchInventorySessionEvents>;
export type NewBatchInventorySessionEvent = InferInsertModel<typeof batchInventorySessionEvents>;
export type Tote = InferSelectModel<typeof totes>;
export type NewTote = InferInsertModel<typeof totes>;
export type ShipmentToteAssignment = InferSelectModel<typeof shipmentToteAssignments>;
export type NewShipmentToteAssignment = InferInsertModel<typeof shipmentToteAssignments>;
export type DispatchAttempt = InferSelectModel<typeof dispatchAttempts>;
export type NewDispatchAttempt = InferInsertModel<typeof dispatchAttempts>;
export type DispatchAttemptSource = InferSelectModel<typeof dispatchAttemptSources>;
export type NewDispatchAttemptSource = InferInsertModel<typeof dispatchAttemptSources>;

/*───────────────────────────
 * BC-aliased exports (monolith)
 * Phase 3에서 WMS schema를 그대로 복사. Phase 4/5/6에서 BC별로 분리 예정.
 *──────────────────────────*/
export const inventoryTables = wmsTables;
export const inventorySchema = wmsSchema;
export type InventorySchema = typeof wmsSchema;

/*───────────────────────────
 * RETURN / EXCHANGE REQUEST
 *──────────────────────────*/

export const returnRequestStatusEnum = pgEnum('return_request_status', [
  'requested',
  'approved',
  'rejected',
  'collection_pending',
  'collected',
  'inspected',
  'refund_pending',
  'completed',
  'cancelled',
]);

export const exchangeRequestStatusEnum = pgEnum('exchange_request_status', [
  'requested',
  'approved',
  'rejected',
  'collection_pending',
  'collected',
  'inspected',
  'refund_pending',
  'completed',
  'cancelled',
]);

export const returnReasonCodeEnum = pgEnum('return_reason_code', [
  'defective',
  'not_as_described',
  'change_of_mind',
  'wrong_item',
  'damaged_in_shipping',
  'other',
]);

export const exchangeReasonCodeEnum = pgEnum('exchange_reason_code', [
  'defective',
  'not_as_described',
  'change_of_mind',
  'wrong_item',
  'damaged_in_shipping',
  'other',
]);

export const returnRefundAttemptStatusEnum = pgEnum('return_refund_attempt_status', ['pending', 'succeeded', 'failed']);

export const returnRequests = pgTable(
  'return_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
      .references(() => salesOrders.id, { onDelete: 'restrict' })
      .notNull(),
    customerId: uuid('customer_id'),
    status: returnRequestStatusEnum('status').notNull().default('requested'),
    reasonCode: returnReasonCodeEnum('reason_code').notNull(),
    reasonDetail: text('reason_detail'),
    returnAddress: json('return_address'),
    adminNote: text('admin_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    collectedAt: timestamp('collected_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxReturnRequestsSalesOrder: index('idx_return_requests_sales_order').on(t.salesOrderId),
    idxReturnRequestsStatus: index('idx_return_requests_status').on(t.status),
    idxReturnRequestsCustomer: index('idx_return_requests_customer').on(t.customerId),
  }),
);

export const returnRequestItems = pgTable(
  'return_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnRequestId: uuid('return_request_id')
      .references(() => returnRequests.id, { onDelete: 'cascade' })
      .notNull(),
    salesOrderLineId: uuid('sales_order_line_id').notNull(),
    // TODO(outbound-v2-contract Task 25): require both links for post-cutover physical returns.
    shipmentLineId: uuid('shipment_line_id').references(() => shipmentLines.id, { onDelete: 'restrict' }),
    dispatchAttemptId: uuid('dispatch_attempt_id').references(() => dispatchAttempts.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    reasonCode: returnReasonCodeEnum('reason_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxReturnRequestItemsRequest: index('idx_return_request_items_request').on(t.returnRequestId),
    idxReturnRequestItemsOrderLine: index('idx_return_request_items_order_line').on(t.salesOrderLineId),
    idxReturnRequestItemsShipmentLine: index('idx_return_request_items_shipment_line').on(t.shipmentLineId),
    idxReturnRequestItemsDispatchAttempt: index('idx_return_request_items_dispatch_attempt').on(t.dispatchAttemptId),
    ckReturnRequestItemQuantity: check('ck_return_request_items_quantity_positive', sql`${t.quantity} > 0`),
  }),
);

export const returnRefundAttempts = pgTable(
  'return_refund_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnRequestId: uuid('return_request_id')
      .references(() => returnRequests.id, { onDelete: 'cascade' })
      .notNull(),
    attemptNumber: integer('attempt_number').notNull(),
    // = correlationId = Wallet Idempotency-Key. 시도별 결정적 key 의 단일 진실(SoT).
    idempotencyKey: text('idempotency_key').notNull(),
    // Wallet body 의 SoT — 재사용(재생) 시 동일 amount 강제 (body-hash 일치).
    amount: integer('amount').notNull(),
    status: returnRefundAttemptStatusEnum('status').notNull().default('pending'),
    walletOutcome: jsonb('wallet_outcome'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uqReturnRefundAttemptNumber: unique('uq_return_refund_attempt_number').on(t.returnRequestId, t.attemptNumber),
    // 불변식: 반품당 in-flight(pending) attempt 최대 1개 — Phase A 의 "pending 재사용" 규칙을 DB 로 강제
    uqReturnRefundAttemptPending: uniqueIndex('uq_return_refund_attempt_pending')
      .on(t.returnRequestId)
      .where(sql`${t.status} = 'pending'`),
    idxReturnRefundAttemptsRequest: index('idx_return_refund_attempts_request').on(t.returnRequestId),
  }),
);

export const exchangeRequests = pgTable(
  'exchange_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
      .references(() => salesOrders.id, { onDelete: 'restrict' })
      .notNull(),
    customerId: uuid('customer_id'),
    status: exchangeRequestStatusEnum('status').notNull().default('requested'),
    reasonCode: exchangeReasonCodeEnum('reason_code').notNull(),
    reasonDetail: text('reason_detail'),
    adminNote: text('admin_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxExchangeRequestsSalesOrder: index('idx_exchange_requests_sales_order').on(t.salesOrderId),
    idxExchangeRequestsStatus: index('idx_exchange_requests_status').on(t.status),
    idxExchangeRequestsCustomer: index('idx_exchange_requests_customer').on(t.customerId),
  }),
);

export const exchangeRequestItems = pgTable(
  'exchange_request_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    exchangeRequestId: uuid('exchange_request_id')
      .references(() => exchangeRequests.id, { onDelete: 'cascade' })
      .notNull(),
    salesOrderLineId: uuid('sales_order_line_id').notNull(),
    quantity: integer('quantity').notNull(),
    desiredVariantId: varchar('desired_variant_id', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxExchangeRequestItemsRequest: index('idx_exchange_request_items_request').on(t.exchangeRequestId),
    idxExchangeRequestItemsOrderLine: index('idx_exchange_request_items_order_line').on(t.salesOrderLineId),
  }),
);

export const returnExchangeTables = {
  returnRequests,
  returnRequestItems,
  exchangeRequests,
  exchangeRequestItems,
  returnRefundAttempts,
} as const;

export const returnExchangeSchema = {
  ...returnExchangeTables,
} as const;

// Return Request Types
export type ReturnRequest = InferSelectModel<typeof returnRequests>;
export type NewReturnRequest = InferInsertModel<typeof returnRequests>;

export type ReturnRequestItem = InferSelectModel<typeof returnRequestItems>;
export type NewReturnRequestItem = InferInsertModel<typeof returnRequestItems>;

export type ReturnRefundAttempt = InferSelectModel<typeof returnRefundAttempts>;
export type NewReturnRefundAttempt = InferInsertModel<typeof returnRefundAttempts>;

// Exchange Request Types
export type ExchangeRequest = InferSelectModel<typeof exchangeRequests>;
export type NewExchangeRequest = InferInsertModel<typeof exchangeRequests>;

export type ExchangeRequestItem = InferSelectModel<typeof exchangeRequestItems>;
export type NewExchangeRequestItem = InferInsertModel<typeof exchangeRequestItems>;
