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
  'MARK_DEFECT', // ON_HAND → DEFECTIVE (불량 지정)
  'REWORK_GOOD', // DEFECTIVE → ON_HAND (불량 양품화)
  'SCRAP', // (ON_HAND|DEFECTIVE) → null (폐기)

  // 수동 조정 (reason 필드로 상세 사유 기록)
  'ADJUST_UP', // null → ON_HAND (재고 증가)
  'ADJUST_DOWN', // ON_HAND → null (재고 감소)
]);

// 확장된 이벤트 타입
export const eventTypeEnum = pgEnum('event_type', [
  // 입고 관련
  'IN', // 일반 입고
  'IN_DOMESTIC', // 국내 거래처 입고
  'IN_OVERSEAS', // 해외 거래처 입고
  'IN_RETURN', // 반품 입고

  // 출고 관련
  'OUT', // 일반 출고
  'OUT_ORDER', // 주문 출고
  'OUT_DAMAGE', // 파손 출고
  'OUT_LOSS', // 분실 출고
  'OUT_DISPOSAL', // 폐기 출고

  // 이동 관련
  'MOVE', // 일반 이동
  'MOVE_INTER_WAREHOUSE', // 창고 간 이동
  'MOVE_INTRA_WAREHOUSE', // 창고 내 이동

  // 조정 관련
  'ADJUST', // 일반 조정
  'ADJUST_MANUAL', // 관리자 수동 조정
  'ADJUST_INVENTORY', // 재고 실사 조정

  // 예약 관련
  'RESERVE',
  'CONFIRM',
  'RELEASE',
  'CANCEL',
]);

// 창고 타입 추가
export const warehouseTypeEnum = pgEnum('warehouse_type', ['domestic', 'overseas', 'bonded', 'return']);

export const reservationStatusEnum = pgEnum('reservation_status', ['pending', 'confirmed', 'released', 'active']);
export const taskStatusEnum = pgEnum('task_status', ['created', 'picking', 'packed', 'shipped', 'canceled']);
export const unavailableReasonEnum = pgEnum('unavailable_reason', ['pb', 'foreign', 'low_margin']);
export const shipmentStatusEnum = pgEnum('shipment_status', ['created', 'in_transit', 'delivered', 'failed']);
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
export const systemLocationRoleEnum = pgEnum('system_location_role', ['inbound_default', 'return_default']);

// 주문 관련 enum 추가
export const orderStatusEnum = pgEnum('order_status', [
  'pending', // 주문 생성 (결제 대기)
  'confirmed', // 주문 확정 (결제 완료)
  'processing', // 처리 중 (일괄주문확정 완료)
  'shipped', // 출고 완료
  'delivered', // 배송 완료
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
export const fulfillmentStatusEnum = pgEnum('fulfillment_status', [
  'created',
  'reserving',
  'ready',
  'unfulfillable',
  'labeled',
  'shipped',
  'canceled',
  // 에러 로그에서 필요한 추가 상태들
  'pending',
  'allocated',
  'picking',
  'picked',
  'inspecting',
  'invoiced',
  'completed',
  'forwarded',
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
export const batchStatusEnum = pgEnum('batch_status', ['created', 'picking', 'completed', 'canceled']);
export const invoiceMethodEnum = pgEnum('invoice_method', ['goodsflow', 'direct', 'self']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['issued', 'printed', 'shipped', 'canceled']);

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// warehouses 테이블에 type 필드 추가
export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 128 }).notNull(),
  type: warehouseTypeEnum('type').notNull().default('domestic'), // 창고 타입 추가
  location: varchar('location', { length: 256 }),
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
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skuId, t.warehouseId, t.locationId, t.stockState] }),
    ckNonNegative: check('ck_ledgers_non_negative', sql`${t.qty} >= 0`),
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

/*───────────────────────────
 * stock_events.eventType: 'OUT' (주문 출고), 'IN' (입고), 'ADJUST' (조정) 등
 * stock_events.reason: 'ORDER_FULFILLED', 'MANUAL_ADJUST' 등
 * stock_events.orderId: 주문 연결
 *──────────────────────────*/

// Fulfillment Orders (FO)
export const fulfillmentOrders = pgTable('fulfillment_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  salesOrderId: uuid('sales_order_id').references(() => salesOrders.id, { onDelete: 'cascade' }),
  warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'set null' }),
  ownerId: uuid('owner_id').references(() => holders.id, { onDelete: 'set null' }),
  status: fulfillmentStatusEnum('status').notNull().default('created'),
  directShipStatus: directShipStatusEnum('direct_ship_status'),

  // 배치 및 출고 관련 필드들
  batchId: uuid('batch_id').references(() => outboundBatches.id, { onDelete: 'set null' }),
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
});

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

export const fulfillmentOrderLines = pgTable('fulfillment_order_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  fulfillmentOrderId: uuid('fulfillment_order_id')
    .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
    .notNull(),
  skuId: uuid('sku_id')
    .references(() => skus.id, { onDelete: 'restrict' })
    .notNull(),
  quantity: integer('quantity').notNull(),
  reservedQty: integer('reserved_qty').notNull().default(0),
  pickedQty: integer('picked_qty').notNull().default(0),
  shippedQty: integer('shipped_qty').notNull().default(0),
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * RESERVATIONS
 *──────────────────────────*/
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // 통합 예약 대상 정보
    targetType: varchar('target_type', { length: 50 }).notNull(), // 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK'
    targetId: uuid('target_id').notNull(), // FO ID 또는 Movement Task ID

    // 기존 FO 호환성을 위해 유지 (nullable로 변경)
    fulfillmentOrderItemId: uuid('fulfillment_order_item_id').references(() => fulfillmentOrderItems.id, {
      onDelete: 'cascade',
    }),

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // 인덱스 추가
    targetIdx: index('stock_reservations_target_idx').on(t.targetType, t.targetId),
    skuWarehouseIdx: index('stock_reservations_sku_warehouse_idx').on(t.skuId, t.warehouseId),
    statusIdx: index('stock_reservations_status_idx').on(t.status),
  }),
);

/*───────────────────────────
 * OUTBOUND TASKS
 *──────────────────────────*/
export const outboundTasks = pgTable('outbound_tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  warehouseId: uuid('warehouse_id')
    .references(() => warehouses.id)
    .notNull(),
  mergeGroupId: varchar('merge_group_id', { length: 64 }).references(() => mergeGroups.id, { onDelete: 'set null' }), // 합배송 그룹 참조
  status: taskStatusEnum('status').notNull().default('created'),
  priority: taskPriorityEnum('priority').notNull().default('normal'),

  totalItems: integer('total_items').notNull().default(0), // 총 품목 수
  totalQuantity: integer('total_quantity').notNull().default(0), // 총 수량

  assignedTo: uuid('assigned_to'), // 작업자 ID
  requiresGiftWrap: boolean('requires_gift_wrap').notNull().default(false), // 선물포장 필요
  temperatureControlled: boolean('temperature_controlled').notNull().default(false), // 온도 제어 필요

  unavailableReason: unavailableReasonEnum('unavailable_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 바구니와 주문 연결 테이블 추가
export const outboundTaskOrders = pgTable(
  'outbound_task_orders',
  {
    taskId: uuid('task_id')
      .references(() => outboundTasks.id, { onDelete: 'cascade' })
      .notNull(),
    orderId: uuid('order_id')
      .references(() => salesOrders.id, { onDelete: 'cascade' })
      .notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.taskId, t.orderId),
  }),
);

// outbound_task_items 수정
export const outboundTaskItems = pgTable(
  'outbound_task_items',
  {
    taskId: uuid('task_id')
      .references(() => outboundTasks.id, { onDelete: 'cascade' })
      .notNull(),
    skuId: uuid('sku_id')
      .references(() => skus.id)
      .notNull(),

    quantityPending: integer('quantity_pending').notNull().default(0),
    quantityPicking: integer('quantity_picking').notNull().default(0),
    quantityPicked: integer('quantity_picked').notNull().default(0),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey(t.taskId, t.skuId),
  }),
);

export const outboundTaskLines = pgTable('outbound_task_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .references(() => outboundTasks.id, { onDelete: 'cascade' })
    .notNull(),
  skuId: uuid('sku_id')
    .references(() => skus.id, { onDelete: 'restrict' })
    .notNull(),
  quantity: integer('quantity').notNull(),
  locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
  scannedBarcode: varchar('scanned_barcode', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * SHIPMENTS
 *──────────────────────────*/
export const shipments = pgTable('shipments', {
  id: uuid('id').primaryKey().defaultRandom(),
  trackingNo: varchar('tracking_no', { length: 64 }).notNull(),
  carrier: carrierEnum('carrier').notNull().default('CJ'),
  status: shipmentStatusEnum('status').notNull().default('created'),
  eta: timestamp('eta', { withTimezone: true }),
  splitStatus: boolean('split_status').notNull().default(false),
  invoiceUrl: varchar('invoice_url', { length: 512 }),
  fulfillmentOrderId: uuid('fulfillment_order_id').references(() => fulfillmentOrders.id, { onDelete: 'set null' }),
  lastUpdated: timestamp('last_updated', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentTracking = pgTable('shipment_tracking', {
  id: uuid('id').primaryKey().defaultRandom(),
  shipmentId: uuid('shipment_id')
    .references(() => shipments.id, { onDelete: 'cascade' })
    .notNull(),
  status: shipmentStatusEnum('status').notNull(),
  location: varchar('location', { length: 255 }),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
});

/*───────────────────────────
 * SALES VARIANT POLICIES
 *──────────────────────────*/
export const salesVariantPolicies = pgTable('sales_variant_policies', {
  variantId: uuid('variant_id').primaryKey(),
  inventoryManagement: boolean('inventory_management').notNull().default(false),
  preStockSellable: boolean('pre_stock_sellable').notNull().default(false),
  alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false),
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
    status: varchar('status', { length: 32 }).notNull().default('pending'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxFulfillmentOrder: index('idx_fulfillment_order_items_fo').on(t.fulfillmentOrderId),
    idxSalesOrder: index('idx_fulfillment_order_items_so').on(t.salesOrderId),
    idxSku: index('idx_fulfillment_order_items_sku').on(t.skuId),
    idxVariant: index('idx_fulfillment_order_items_variant').on(t.variantId),
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
    assignedTo: varchar('assigned_to', { length: 255 }), // 작업자 ID

    // 에러 로그에서 필요한 추가 컬럼들
    name: varchar('name', { length: 255 }),
    totalItems: integer('total_items').notNull().default(0),
    totalQty: integer('total_qty').notNull().default(0),
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

export const fulfillmentOrderBatches = pgTable(
  'fulfillment_order_batches',
  {
    fulfillmentOrderId: uuid('fulfillment_order_id')
      .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
      .notNull(),
    batchId: uuid('batch_id')
      .references(() => outboundBatches.id, { onDelete: 'cascade' })
      .notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removeReason: varchar('remove_reason', { length: 255 }),
  },
  (t) => ({
    pk: primaryKey(t.fulfillmentOrderId, t.batchId),
    idxBatch: index('idx_fulfillment_order_batches_batch').on(t.batchId),
  }),
);

/*───────────────────────────
 * INVOICE MANAGEMENT
 *──────────────────────────*/

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentOrderId: uuid('fulfillment_order_id')
      .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
      .notNull(),
    invoiceNumber: varchar('invoice_number', { length: 128 }).notNull().unique(),
    carrierCode: varchar('carrier_code', { length: 32 }),
    issueMethod: invoiceMethodEnum('issue_method').notNull(),
    goodsflowServiceId: varchar('goodsflow_service_id', { length: 255 }),
    status: invoiceStatusEnum('status').notNull().default('issued'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    printedAt: timestamp('printed_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idxFulfillmentOrder: index('idx_invoices_fo').on(t.fulfillmentOrderId),
    idxInvoiceNumber: index('idx_invoices_number').on(t.invoiceNumber),
    idxStatus: index('idx_invoices_status').on(t.status),
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
  fulfillmentOrderLines,
  outboundTasks,
  outboundTaskOrders,
  outboundTaskItems,
  outboundTaskLines,
  shipments,
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

  // Stocktaking
  stocktakingSessions,
  stocktakingLines,
  stocktakingAdjustments,

  // FOI 기반 확장 스키마
  productSkuMappings,
  productSkuMappingItems,
  productSkuMappingSnapshots,
  fulfillmentOrderItems,
  outboundBatches,
  fulfillmentOrderBatches,
  invoices,
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
import { TypedDatabase } from '@app/db/types';

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
  fulfillmentOrderLines: many(fulfillmentOrderLines),
  fulfillmentOrderItems: many(fulfillmentOrderItems),
  outboundTaskItems: many(outboundTaskItems),
  outboundTaskLines: many(outboundTaskLines),
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
  outboundTasks: many(outboundTasks),
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
  outboundTaskLines: many(outboundTaskLines),
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
}));

// Stock Relations
export const stockJournalsRelations = relations(stockJournals, ({ many }) => ({
  stockEvents: many(stockEvents),
  movementJobs: many(movementJobs),
  inboundReceipts: many(inboundReceipts),
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
export const salesOrdersRelations = relations(salesOrders, ({ many }) => ({
  lines: many(salesOrderLines),
  fulfillmentOrders: many(fulfillmentOrders),
  fulfillmentOrderCreationBacklogs: many(fulfillmentOrderCreationBacklogs),
  orderEvents: many(orderEvents),
  cancellations: many(salesOrderCancellations),
  outboundTaskOrders: many(outboundTaskOrders),
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

export const mergeGroupsRelations = relations(mergeGroups, ({ many }) => ({
  outboundTasks: many(outboundTasks),
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
  batch: one(outboundBatches, {
    fields: [fulfillmentOrders.batchId],
    references: [outboundBatches.id],
  }),
  lines: many(fulfillmentOrderLines),
  items: many(fulfillmentOrderItems),
  creationBacklogs: many(fulfillmentOrderCreationBacklogs),
  shipments: many(shipments),
  fulfillmentOrderBatches: many(fulfillmentOrderBatches),
  invoices: many(invoices),
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

export const fulfillmentOrderLinesRelations = relations(fulfillmentOrderLines, ({ one }) => ({
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [fulfillmentOrderLines.fulfillmentOrderId],
    references: [fulfillmentOrders.id],
  }),
  sku: one(skus, {
    fields: [fulfillmentOrderLines.skuId],
    references: [skus.id],
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
}));

// Outbound Relations
export const outboundTasksRelations = relations(outboundTasks, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [outboundTasks.warehouseId],
    references: [warehouses.id],
  }),
  mergeGroup: one(mergeGroups, {
    fields: [outboundTasks.mergeGroupId],
    references: [mergeGroups.id],
  }),
  outboundTaskOrders: many(outboundTaskOrders),
  outboundTaskItems: many(outboundTaskItems),
  outboundTaskLines: many(outboundTaskLines),
}));

export const outboundTaskOrdersRelations = relations(outboundTaskOrders, ({ one }) => ({
  task: one(outboundTasks, {
    fields: [outboundTaskOrders.taskId],
    references: [outboundTasks.id],
  }),
  order: one(salesOrders, {
    fields: [outboundTaskOrders.orderId],
    references: [salesOrders.id],
  }),
}));

export const outboundTaskItemsRelations = relations(outboundTaskItems, ({ one }) => ({
  task: one(outboundTasks, {
    fields: [outboundTaskItems.taskId],
    references: [outboundTasks.id],
  }),
  sku: one(skus, {
    fields: [outboundTaskItems.skuId],
    references: [skus.id],
  }),
}));

export const outboundTaskLinesRelations = relations(outboundTaskLines, ({ one }) => ({
  task: one(outboundTasks, {
    fields: [outboundTaskLines.taskId],
    references: [outboundTasks.id],
  }),
  sku: one(skus, {
    fields: [outboundTaskLines.skuId],
    references: [skus.id],
  }),
  location: one(locations, {
    fields: [outboundTaskLines.locationId],
    references: [locations.id],
  }),
}));

export const outboundBatchesRelations = relations(outboundBatches, ({ one, many }) => ({
  warehouse: one(warehouses, {
    fields: [outboundBatches.warehouseId],
    references: [warehouses.id],
  }),
  fulfillmentOrders: many(fulfillmentOrders),
  fulfillmentOrderBatches: many(fulfillmentOrderBatches),
}));

export const fulfillmentOrderBatchesRelations = relations(fulfillmentOrderBatches, ({ one }) => ({
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [fulfillmentOrderBatches.fulfillmentOrderId],
    references: [fulfillmentOrders.id],
  }),
  batch: one(outboundBatches, {
    fields: [fulfillmentOrderBatches.batchId],
    references: [outboundBatches.id],
  }),
}));

// Shipment Relations
export const shipmentsRelations = relations(shipments, ({ one, many }) => ({
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [shipments.fulfillmentOrderId],
    references: [fulfillmentOrders.id],
  }),
  shipmentTracking: many(shipmentTracking),
  returns: many(returns),
}));

export const shipmentTrackingRelations = relations(shipmentTracking, ({ one }) => ({
  shipment: one(shipments, {
    fields: [shipmentTracking.shipmentId],
    references: [shipments.id],
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

// Invoice Relations
export const invoicesRelations = relations(invoices, ({ one }) => ({
  fulfillmentOrder: one(fulfillmentOrders, {
    fields: [invoices.fulfillmentOrderId],
    references: [fulfillmentOrders.id],
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
  mergeGroupsRelations,

  // Fulfillment Order Relations
  fulfillmentOrdersRelations,
  fulfillmentOrderCreationBacklogsRelations,
  fulfillmentOrderLinesRelations,
  fulfillmentOrderItemsRelations,

  // Outbound Relations
  outboundTasksRelations,
  outboundTaskOrdersRelations,
  outboundTaskItemsRelations,
  outboundTaskLinesRelations,
  outboundBatchesRelations,
  fulfillmentOrderBatchesRelations,

  // Shipment Relations
  shipmentsRelations,
  shipmentTrackingRelations,
  returnsRelations,

  // Invoice Relations
  invoicesRelations,

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

export type DbTx = Parameters<Parameters<TypedDatabase<typeof wmsSchema>['transaction']>[0]>[0];

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

export type FulfillmentOrderLine = InferSelectModel<typeof fulfillmentOrderLines>;
export type NewFulfillmentOrderLine = InferInsertModel<typeof fulfillmentOrderLines>;

export type FulfillmentOrderItem = InferSelectModel<typeof fulfillmentOrderItems>;
export type NewFulfillmentOrderItem = InferInsertModel<typeof fulfillmentOrderItems>;

// Outbound Types
export type OutboundTask = InferSelectModel<typeof outboundTasks>;
export type NewOutboundTask = InferInsertModel<typeof outboundTasks>;

export type OutboundTaskOrder = InferSelectModel<typeof outboundTaskOrders>;
export type NewOutboundTaskOrder = InferInsertModel<typeof outboundTaskOrders>;

export type OutboundTaskItem = InferSelectModel<typeof outboundTaskItems>;
export type NewOutboundTaskItem = InferInsertModel<typeof outboundTaskItems>;

export type OutboundTaskLine = InferSelectModel<typeof outboundTaskLines>;
export type NewOutboundTaskLine = InferInsertModel<typeof outboundTaskLines>;

export type OutboundBatch = InferSelectModel<typeof outboundBatches>;
export type NewOutboundBatch = InferInsertModel<typeof outboundBatches>;

export type FulfillmentOrderBatch = InferSelectModel<typeof fulfillmentOrderBatches>;
export type NewFulfillmentOrderBatch = InferInsertModel<typeof fulfillmentOrderBatches>;

// Shipment Types
export type Shipment = InferSelectModel<typeof shipments>;
export type NewShipment = InferInsertModel<typeof shipments>;

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

// Invoice Types
export type Invoice = InferSelectModel<typeof invoices>;
export type NewInvoice = InferInsertModel<typeof invoices>;

/*───────────────────────────
 * BC-aliased exports (monolith)
 * Phase 3에서 WMS schema를 그대로 복사. Phase 4/5/6에서 BC별로 분리 예정.
 *──────────────────────────*/
export const inventoryTables = wmsTables;
export const inventorySchema = wmsSchema;
export type InventorySchema = typeof wmsSchema;
