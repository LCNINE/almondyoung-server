// apps/wms/database/schemas/wms-schema.ts
import { sql, eq } from 'drizzle-orm';
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
    check,
} from 'drizzle-orm/pg-core';

/*───────────────────────────
 * ENUM DECLARATIONS
 *──────────────────────────*/
export const barcodeTypeEnum = pgEnum('barcode_type', ['standard']);
export const sourceTypeEnum = pgEnum('source_type', ['direct', 'in_house', 'overseas']);

export const eventStatusEnum = pgEnum('event_status', ['PENDING','POSTED','VOIDED']);
export const stockStateEnum = pgEnum("stock_state", [
    "ON_HAND",         // 출고가능 or 가용재고
    "DEFECTIVE",       // 불량
    "IN_TRANSFER",     // 창고간 운송중
]);
/** 상태 전이 타입(enum) */
export const transitionTypeEnum = pgEnum("transition_type", [
    // 기본 흐름
    "RECEIVE",                 // null → ON_HAND (입고)
    "SHIP",                    // ON_HAND → null (출고) - 예약 없이 직접 출고
    "MOVE",                    // 이동 (창고내/창고간 통합)

    // 품질 관리
    "MARK_DEFECT",             // ON_HAND → DEFECTIVE (불량 지정)
    "REWORK_GOOD",             // DEFECTIVE → ON_HAND (불량 양품화)
    "SCRAP",                   // (ON_HAND|DEFECTIVE) → null (폐기)

    // 수동 조정 (reason 필드로 상세 사유 기록)
    "ADJUST_UP",               // null → ON_HAND (재고 증가)
    "ADJUST_DOWN",             // ON_HAND → null (재고 감소)
  ]);


// 확장된 이벤트 타입
export const eventTypeEnum = pgEnum('event_type', [
    // 입고 관련
    'IN',                     // 일반 입고
    'IN_DOMESTIC',           // 국내 거래처 입고
    'IN_OVERSEAS',           // 해외 거래처 입고
    'IN_RETURN',             // 반품 입고

    // 출고 관련
    'OUT',                   // 일반 출고
    'OUT_ORDER',             // 주문 출고
    'OUT_DAMAGE',            // 파손 출고
    'OUT_LOSS',              // 분실 출고
    'OUT_DISPOSAL',          // 폐기 출고

    // 이동 관련
    'MOVE',                  // 일반 이동
    'MOVE_INTER_WAREHOUSE',  // 창고 간 이동
    'MOVE_INTRA_WAREHOUSE',  // 창고 내 이동

    // 조정 관련
    'ADJUST',                // 일반 조정
    'ADJUST_MANUAL',         // 관리자 수동 조정
    'ADJUST_INVENTORY',      // 재고 실사 조정

    // 예약 관련
    'RESERVE',
    'CONFIRM',
    'RELEASE',
    'CANCEL'
]);

// 창고 타입 추가
export const warehouseTypeEnum = pgEnum('warehouse_type', ['domestic', 'overseas', 'bonded', 'return']);

export const reservationStatusEnum = pgEnum('reservation_status', ['pending', 'confirmed', 'released']);
export const taskStatusEnum = pgEnum('task_status', ['created', 'picking', 'packed', 'shipped', 'canceled']);
export const unavailableReasonEnum = pgEnum('unavailable_reason', ['pb', 'foreign', 'low_margin']);
export const shipmentStatusEnum = pgEnum('shipment_status', ['created', 'in_transit', 'delivered', 'failed']);
export const returnStatusEnum = pgEnum('return_status', ['requested', 'received', 'qc_passed', 'qc_failed', 'disposed']);
export const matchingStatusEnum = pgEnum('matching_status', ['pending', 'matched', 'ignored']);
export const matchingPriorityEnum = pgEnum('matching_priority', ['normal', 'high']);

// 매칭 전략 enum 추가
export const matchingStrategyEnum = pgEnum('matching_strategy', ['void', 'variant', 'option']);

export const settingKeyEnum = pgEnum('setting_key', ['use_sub_barcode', 'use_expiry_separation']);
export const poTypeEnum = pgEnum('po_type', ['domestic', 'foreign']);
export const poStatusEnum = pgEnum('po_status', ['created', 'confirmed', 'received']);
export const inboundStatusEnum = pgEnum('inbound_status', ['pending', 'confirmed']);
export const stockTypeEnum = pgEnum('stock_type', ['physical', 'infinite', 'drop_shipped', 'consignment']);

// Inbound domain enums
export const inboundMethodEnum = pgEnum('inbound_method', [
    'individual',           // 개별입고
    'simple',               // 간편입고
    'simple_fullscan',      // 전수검사 간편입고
    'planned',              // 입고예정검수 기반 실입고
]);
export const inboundReceiptStatusEnum = pgEnum('inbound_receipt_status', ['posted', 'voided']);
export const inboundWorkTypeEnum = pgEnum('inbound_work_type', ['INBOUND', 'PUTAWAY', 'RETURN', 'CANCEL']);

export const locationTypeEnum = pgEnum('location_type', ['standard', 'zone']);
// 시스템 로케이션 역할(enum)
export const systemLocationRoleEnum = pgEnum('system_location_role', [
    'inbound_default',
    'return_default',
]);

// 주문 관련 enum 추가
export const orderStatusEnum = pgEnum('order_status', [
    'pending',        // 주문 생성 (결제 대기)
    'confirmed',      // 주문 확정 (결제 완료)
    'processing',     // 처리 중 (일괄주문확정 완료)
    'shipped',        // 출고 완료
    'delivered',      // 배송 완료
    'cancelled',      // 취소
    'timeout'         // 타임아웃
]);

export const orderItemStatusEnum = pgEnum('order_item_status', [
    'pending',            // 대기 중
    'matched',            // 재고 매칭 완료
    'stock_deducted',     // 재고 차감 완료
    'stock_unavailable',  // 재고 부족
    'cancelled'           // 취소
]);

export const salesChannelEnum = pgEnum('sales_channel', [
    'medusa',         // 메두사 (자체 몰)
    'naver',          // 네이버 스마트스토어
    'coupang',        // 쿠팡
    '3pl'    // 3PL
]);

export const eventTypeOrderEnum = pgEnum('event_type_order', [
    'ORDER_CREATED',     // 주문 생성
    'ORDER_CONFIRMED',   // 주문 확정
    'ORDER_MODIFIED',    // 주문 수정
    'ORDER_CANCELLED'    // 주문 취소
]);

export const taskPriorityEnum = pgEnum('task_priority', ['normal', 'high', 'express']);
export const fulfillmentStatusEnum = pgEnum('fulfillment_status', [
    'created',
    'reserving',
    'ready',
    'labeled',
    'shipped',
    'canceled',
]);
export const fulfillmentModeEnum = pgEnum('fulfillment_mode', ['in_house', 'third_party_3pl', 'drop_ship']);
export const outboxStatusEnum = pgEnum('outbox_status', ['pending', 'published', 'failed']);

// FOI 기반 확장 enums
export const pickingMethodEnum = pgEnum('picking_method', ['individual', 'total_picking']);
export const batchStatusEnum = pgEnum('batch_status', ['created', 'picking', 'completed', 'canceled']);
export const invoiceMethodEnum = pgEnum('invoice_method', ['goodsflow', 'direct', 'self']);
export const invoiceStatusEnum = pgEnum('invoice_status', ['issued', 'printed', 'shipped', 'canceled']);

// Audit system enums
export const auditEventTypeEnum = pgEnum('audit_event_type', [
    // 사용자 액션
    'USER_LOGIN', 'USER_LOGOUT', 'USER_ACTION',

    // 재고 관련
    'STOCK_CREATED', 'STOCK_UPDATED', 'STOCK_DELETED',
    'STOCK_RESERVED', 'STOCK_UNRESERVED', 'STOCK_MOVED',

    // 주문 관련
    'ORDER_CREATED', 'ORDER_CONFIRMED', 'ORDER_CANCELLED', 'ORDER_MERGED',
    'FULFILLMENT_CREATED', 'FULFILLMENT_READY', 'FULFILLMENT_SHIPPED',

    // SKU/상품 관련
    'SKU_CREATED', 'SKU_UPDATED', 'SKU_DELETED',
    'PRODUCT_MATCHED', 'PRODUCT_MATCHING_RESOLVED',

    // 시스템 이벤트
    'SYSTEM_STARTUP', 'SYSTEM_ERROR', 'SYSTEM_WARNING',

    // 설정 변경
    'CONFIG_CHANGED', 'POLICY_CHANGED'
]);

export const auditSeverityEnum = pgEnum('audit_severity', [
    'INFO', 'WARN', 'ERROR', 'CRITICAL'
]);

// Inventory master enums
export const inventoryMasterPurposeEnum = pgEnum('inventory_master_purpose', ['standard', 'set', 'material']);
export const inventoryMasterStatusEnum = pgEnum('inventory_master_status', ['active', 'archived']);

/*───────────────────────────
 * MASTER DATA
 *──────────────────────────*/
export const suppliers = pgTable('suppliers', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    contactInfo: json('contact_info'), // 연락처, 주소 등
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * MOVEMENT JOBS (헤더/라인/타임라인)
 *──────────────────────────*/
export const movementJobs = pgTable('movement_jobs', {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    totalQuantity: integer('total_quantity').notNull().default(0),
    journalId: uuid('journal_id').references(() => stockJournals.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id'),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxMovementJobsWhTime: index('idx_movement_jobs_wh_time').on(t.warehouseId, t.occurredAt),
}));

export const movementJobLines = pgTable('movement_job_lines', {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    jobId: uuid('job_id').references(() => movementJobs.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    fromLocationId: uuid('from_location_id').references(() => locations.id, { onDelete: 'set null' }),
    toLocationId: uuid('to_location_id').references(() => locations.id, { onDelete: 'set null' }),
    eventId: uuid('event_id').references(() => stockEvents.id, { onDelete: 'set null' }),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxMovementLinesJob: index('idx_movement_lines_job').on(t.jobId),
    idxMovementLinesSku: index('idx_movement_lines_sku').on(t.skuId),
}));

export const movementWorkLogs = pgTable('movement_work_logs', {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
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
}, t => ({
    idxMovementWorkTime: index('idx_movement_work_time').on(t.timestamp),
}));

export const holders = pgTable('holders', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    isOurAsset: boolean('is_our_asset').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const skus = pgTable('skus', {
    id: uuid('id').primaryKey().defaultRandom(),
    holderId: uuid('holder_id').references(() => holders.id, { onDelete: 'cascade' }).default("00000000-0000-0000-0000-000000000000").notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 64 }).notNull().unique(),
    defaultBarcode: varchar('default_barcode', { length: 64 }), // SKU의 기본 바코드 (skuBarcodes에서 관리, 자동생성됨)
    stockType: stockTypeEnum('stock_type').notNull().default('physical'),
    deliveryProfileId: uuid('delivery_profile_id').references(() => deliveryProfiles.id, { onDelete: 'set null' }),
    sale1m: integer('sale_1m'),
    sale3m: integer('sale_3m'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const skuSuppliers = pgTable('sku_suppliers', {
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),
    supplierId: uuid('supplier_id')
        .references(() => suppliers.id, { onDelete: 'cascade' })
        .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.skuId, t.supplierId),
}));

export const skuBarcodes = pgTable('sku_barcodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'cascade' }).notNull(),
    barcode: varchar('barcode', { length: 64 }).notNull().unique(), // 실제 바코드 값
    barcodeType: barcodeTypeEnum('barcode_type').notNull(),
    packingUnit: varchar('packing_unit', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const categories = pgTable('categories', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const skuCategories = pgTable('sku_categories', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'cascade' }).notNull(),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// Inventory Product Masters: 상위 재고상품 설계 단위(옵션 스키마/정책 보유)
export const inventoryProductMasters = pgTable('inventory_product_masters', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    masterCode: varchar('master_code', { length: 64 }).notNull(),
    purpose: inventoryMasterPurposeEnum('purpose').notNull().default('standard'),
    optionSchema: json('option_schema'),
    defaultPolicy: json('default_policy'),
    status: inventoryMasterStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uqMasterCode: unique().on(t.masterCode),
}));

// Inventory Master ↔ SKU 링크: 옵션키 기반 연결 및 대표 여부
export const inventoryMasterSkuLinks = pgTable('inventory_master_sku_links', {
    masterId: uuid('master_id').references(() => inventoryProductMasters.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'cascade' }).notNull(),
    optionKey: jsonb('option_key'),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.masterId, t.skuId),
    uqMasterOption: unique().on(t.masterId, t.optionKey),
}));

export const deliveryProfiles = pgTable('delivery_profiles', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 128 }).notNull(),
    sourceType: sourceTypeEnum('source_type').notNull(),
    avgDeliveryDays: integer('avg_delivery_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// warehouses 테이블에 type 필드 추가
export const warehouses = pgTable('warehouses', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 128 }).notNull(),
    type: warehouseTypeEnum('type').default('domestic'), // 창고 타입 추가
    location: varchar('location', { length: 256 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * LOCATION
 *──────────────────────────*/
export const locationColumns = pgTable('location_columns', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    columnName: varchar('column_name', { length: 10 }).notNull(),
    displayOrder: integer('display_order'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uqWarehouseColumn: unique().on(t.warehouseId, t.columnName),
    idxColumnsWarehouseName: index('idx_columns_warehouse_name').on(t.warehouseId, t.columnName),
}));

export const locationRacks = pgTable('location_racks', {
    id: uuid('id').primaryKey().defaultRandom(),
    columnId: uuid('column_id').references(() => locationColumns.id, { onDelete: 'cascade' }).notNull(),
    rackNumber: integer('rack_number').notNull(),
    defaultBinStart: integer('default_bin_start').default(1),
    defaultBinEnd: integer('default_bin_end').default(20),
    autoGenerateBins: boolean('auto_generate_bins').default(true),
    physicalWidth: integer('physical_width'),
    physicalHeight: integer('physical_height'),
    notes: text('notes'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uqColumnRack: unique().on(t.columnId, t.rackNumber),
    idxRacksColumnNumber: index('idx_racks_column_number').on(t.columnId, t.rackNumber),
}));

export const locations = pgTable('locations', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    code: varchar('code', { length: 64 }).notNull(),
    locationType: locationTypeEnum('location_type').notNull(),
    rackId: uuid('rack_id').references(() => locationRacks.id, { onDelete: 'cascade' }),
    binIdentifier: varchar('bin_identifier', { length: 20 }),
    displayName: varchar('display_name', { length: 128 }),
    capacityLimit: integer('capacity_limit'),
    fifoRank: integer('fifo_rank'),
    isExpirySeparated: boolean('is_expiry_separated'),
    isActive: boolean('is_active').default(true),
    notes: text('notes'),
    // 시스템 로케이션 보호 필드
    isSystem: boolean('is_system').notNull().default(false),
    systemRole: systemLocationRoleEnum('system_role'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uqWarehouseCode: unique().on(t.warehouseId, t.code),
    uqWarehouseSystemRole: unique().on(t.warehouseId, t.systemRole),
    ckLocationsType: check('ck_locations_type', sql`(
        (location_type = 'standard' AND rack_id IS NOT NULL AND bin_identifier IS NOT NULL)
        OR 
        (location_type = 'zone' AND rack_id IS NULL AND bin_identifier IS NULL)
    )`),
    ckLocationsSystemRole: check('ck_locations_system_role', sql`( (is_system = true AND system_role IS NOT NULL) OR (is_system = false AND system_role IS NULL) )`),
    ckLocationsSystemZone: check('ck_locations_system_zone', sql`( is_system = false OR location_type = 'zone' )`),
    locationsWarehouseType: index('idx_locations_warehouse_type').on(t.warehouseId, t.locationType),
    locationsRackBin: index('idx_locations_rack_bin').on(t.rackId, t.binIdentifier),
}));

// indexes moved into table definitions above

/*───────────────────────────
 * STOCK LEDGER
 *──────────────────────────*/
export const stockJournals = pgTable("stock_journals", {
    id: uuid("id").primaryKey().default(sql`uuid_v7()`),
    sourceType: varchar("source_type", { length: 64 }),
    sourceId: uuid("source_id"),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
    actorId: uuid("actor_id"),
  });


  export const stockEvents = pgTable(
    "stock_events",
    {
      id: uuid("id").primaryKey().default(sql`uuid_v7()`),
  
      journalId: uuid("journal_id").references(() => stockJournals.id),
  
      skuId: uuid("sku_id").notNull().references(() => skus.id),
  
      fromWarehouseId: uuid("from_warehouse_id").references(() => warehouses.id),
      fromLocationId: uuid("from_location_id").references(() => locations.id, { onDelete: "set null" }),
      toWarehouseId: uuid("to_warehouse_id").references(() => warehouses.id),
      toLocationId: uuid("to_location_id").references(() => locations.id, { onDelete: "set null" }),
  
      fromState: stockStateEnum("from_state"),
      toState: stockStateEnum("to_state"),
      transitionType: transitionTypeEnum("transition_type").notNull(),
  
      quantity: integer("quantity").notNull(), // 항상 양수
  
      occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
      recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  
      idempotencyKey: varchar("idempotency_key", { length: 128 }).unique(),
      eventStatus: eventStatusEnum("event_status").notNull().default("POSTED"),
      reversalOfEventId: uuid("reversal_of_event_id"),
      voidedByEventId: uuid("voided_by_event_id"),
      reason: varchar("reason", { length: 255 }),
    },
    (t) => ({
      ixGrainTime: index("ix_stock_events_grain_time").on(
        t.skuId, t.fromWarehouseId, t.toWarehouseId, t.occurredAt
      ),
      ckQtyPositive: check("ck_events_qty_positive", sql`${t.quantity} > 0`),
      ckStatesDifferent: check("ck_events_states_diff", sql`${t.fromState} is distinct from ${t.toState}`),
      ckSidePresent: check(
        "ck_events_side_present",
        sql`(${t.fromState} is not null) or (${t.toState} is not null)`
      ),
      ckFromLocNeedsWh: check(
        "ck_events_fromloc_has_wh",
        sql`(${t.fromLocationId} is null) or (${t.fromWarehouseId} is not null)`
      ),
      ckToLocNeedsWh: check(
        "ck_events_toloc_has_wh",
        sql`(${t.toLocationId} is null) or (${t.toWarehouseId} is not null)`
      ),
    })
  );


export const stockLedgers = pgTable(
  "stock_ledgers",
  {
    skuId: uuid("sku_id").notNull().references(() => skus.id, { onDelete: "restrict" }),
    warehouseId: uuid("warehouse_id").notNull().references(() => warehouses.id),
    locationId: uuid("location_id").notNull().references(() => locations.id),
    stockState: stockStateEnum("stock_state").notNull(),
    qty: integer("qty").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.skuId, t.warehouseId, t.locationId, t.stockState] }),
    ckNonNegative: check("ck_ledgers_non_negative", sql`${t.qty} >= 0`),
    ixLookup: index("ix_ledgers_lookup").on(t.skuId, t.warehouseId, t.locationId, t.stockState),
  })
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
        COALESCE(on_hand.qty, 0) - COALESCE(reserved.qty, 0) as available_qty,

        -- 예정 상태
        COALESCE(inbound_pending.qty, 0) as inbound_pending_qty,
        0 as on_order_qty,
        0 as transfer_pending_qty,

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
        SELECT ipi.sku_id, ip.warehouse_id, SUM(ipi.expected_qty - ipi.received_qty) as qty
        FROM inbound_plan_items ipi
        INNER JOIN inbound_plans ip ON ipi.plan_id = ip.id
        WHERE ipi.status = 'pending'
        GROUP BY ipi.sku_id, ip.warehouse_id
    ) inbound_pending ON s.id = inbound_pending.sku_id AND w.id = inbound_pending.warehouse_id
`);

/*───────────────────────────
 * PRODUCT / VARIANT / SKU MAPPING
 *──────────────────────────*/
export const productMatchings = pgTable('product_matchings', {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    masterId: uuid('master_id').references(() => inventoryProductMasters.id, { onDelete: 'set null' }),
    status: matchingStatusEnum('status').notNull().default('pending'), // 매칭 상태 (pending, matched, ignored)
    priority: matchingPriorityEnum('priority').notNull().default('normal'), // 매칭 우선순위
    strategy: matchingStrategyEnum('strategy'), // 매칭 전략 (void, variant, option)
    isResolved: boolean('is_resolved').notNull().default(false), // 매칭이 해결되었는지
    // 재고 정책 필드들 (skus에서 이동)
    inventoryManagement: boolean('inventory_management').notNull().default(false), // true: 물리적 재고 관리, false: 디지털
    preStockSellable: boolean('pre_stock_sellable').notNull().default(true), // 재고 0이어도 선판매 가능한지 여부 (default true로 변경)
    alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false), // 재고 0이어도 항상 판매 가능한 상품 (직배/신상품)

    // isGift 제거 (사은품 속성은 판매주문 라인 등 상위로 이동)

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uniqueVariantId: unique().on(t.variantId), // variant당 하나의 매칭만 존재
    idxMasterId: index('idx_product_matchings_master_id').on(t.masterId),
}));

// product_variant_sku_links: variant와 sku의 N:M 관계를 위한 연결 테이블
export const productVariantSkuLinks = pgTable('product_variant_sku_links', {
    productMatchingId: uuid('product_matching_id')
        .references(() => productMatchings.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),
    quantity: integer('quantity').notNull().default(1), // 구성 수량 (세트 상품용)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.productMatchingId, t.skuId),
}));

// 옵션별 매칭을 위한 테이블 추가
export const productOptionMatchings = pgTable('product_option_matchings', {
    id: uuid('id').primaryKey().defaultRandom(),
    productMatchingId: uuid('product_matching_id')
        .references(() => productMatchings.id, { onDelete: 'cascade' })
        .notNull(),
    optionName: varchar('option_name', { length: 255 }).notNull(), // 예: 'CPU', 'RAM'
    optionValue: varchar('option_value', { length: 255 }).notNull(), // 예: 'i7', '16GB'
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uniqueOptionMatching: unique().on(t.productMatchingId, t.optionName, t.optionValue),
}));

/*───────────────────────────
 * ORDER MANAGEMENT
 *──────────────────────────*/
// 주문 테이블 추가
export const salesOrders = pgTable('sales_orders', {
    id: uuid('id').primaryKey().defaultRandom(),
    channelOrderId: varchar('channel_order_id', { length: 255 }).notNull(), // 채널별 주문 ID
    salesChannel: salesChannelEnum('sales_channel').notNull(),
    status: orderStatusEnum('status').notNull().default('pending'),

    // 고객 정보
    customerName: varchar('customer_name', { length: 255 }),
    customerEmail: varchar('customer_email', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 50 }),

    // 배송 정보
    shippingAddress: json('shipping_address').notNull(), // 배송지 전체 정보
    shippingAddressHash: varchar('shipping_address_hash', { length: 64 }), // 합배송 처리용 해시

    // 금액 정보
    totalAmount: integer('total_amount'), // 총 주문 금액
    shippingFee: integer('shipping_fee').default(0), // 배송비

    // 합배송 정보
    mergeGroupId: varchar('merge_group_id', { length: 64 }), // 합배송 그룹 ID
    isMerged: boolean('is_merged').notNull().default(false), // 합배송 여부

    // 타임스탬프
    orderDate: timestamp('order_date', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uniqueChannelOrder: unique().on(t.salesChannel, t.channelOrderId), // 채널별 주문 ID 유니크
}));

// 주문 상품 테이블 추가
export const salesOrderLines = pgTable('sales_order_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    salesOrderId: uuid('sales_order_id')
        .references(() => salesOrders.id, { onDelete: 'cascade' })
        .notNull(),
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    productMatchingId: uuid('product_matching_id')
        .references(() => productMatchings.id, { onDelete: 'set null' }), // 매칭 정보

    productName: varchar('product_name', { length: 255 }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price'), // 단가
    totalPrice: integer('total_price'), // 총 가격

    status: orderItemStatusEnum('status').notNull().default('pending'),
    suggestedQuantity: integer('suggested_quantity'), // 부분 수량 제안
    unavailableSkuIds: json('unavailable_sku_ids'), // 부족한 SKU 정보

    deductedAt: timestamp('deducted_at', { withTimezone: true }), // 재고 차감 시간

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// 주문 이벤트 로그 테이블 추가
export const orderEvents = pgTable('order_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: varchar('event_id', { length: 255 }).notNull().unique(), // 멱등성 체크용
    orderId: uuid('order_id')
        .references(() => salesOrders.id, { onDelete: 'cascade' })
        .notNull(),
    eventType: eventTypeOrderEnum('event_type').notNull(),
    payload: json('payload').notNull(), // 이벤트 데이터
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// 합배송 그룹 테이블 추가
export const mergeGroups = pgTable('merge_groups', {
    id: varchar('id', { length: 64 }).primaryKey(), // G-{sequence} 형태
    customerEmail: varchar('customer_email', { length: 255 }).notNull(),
    shippingAddressHash: varchar('shipping_address_hash', { length: 64 }).notNull(),
    totalShippingFee: integer('total_shipping_fee').default(0),
    orderCount: integer('order_count').default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
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
    shippingAddress: json('shipping_address'),
    labelNo: varchar('label_no', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const fulfillmentOrderLines = pgTable('fulfillment_order_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentOrderId: uuid('fulfillment_order_id')
        .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    reservedQty: integer('reserved_qty').notNull().default(0),
    pickedQty: integer('picked_qty').notNull().default(0),
    shippedQty: integer('shipped_qty').notNull().default(0),
    status: varchar('status', { length: 32 }).notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * RESERVATIONS
 *──────────────────────────*/
export const stockReservations = pgTable('stock_reservations', {
    reservationId: uuid('reservation_id').primaryKey().defaultRandom(),

    // 통합 예약 대상 정보
    targetType: varchar('target_type', { length: 50 }).notNull(), // 'FULFILLMENT_ORDER' | 'MOVEMENT_TASK'
    targetId: uuid('target_id').notNull(), // FO ID 또는 Movement Task ID

    // 기존 FO 호환성을 위해 유지 (nullable로 변경)
    fulfillmentOrderItemId: uuid('fulfillment_order_item_id')
        .references(() => fulfillmentOrderItems.id, { onDelete: 'cascade' }),

    // 예약 기본 정보
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    status: reservationStatusEnum('status').notNull().default('pending'),

    // 예약 메타 정보
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    reason: text('reason'), // 예약 사유
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    // 인덱스 추가
    targetIdx: index('stock_reservations_target_idx').on(t.targetType, t.targetId),
    skuWarehouseIdx: index('stock_reservations_sku_warehouse_idx').on(t.skuId, t.warehouseId),
    statusIdx: index('stock_reservations_status_idx').on(t.status),
}));

/*───────────────────────────
 * OUTBOUND TASKS
 *──────────────────────────*/
export const outboundTasks = pgTable('outbound_tasks', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
    mergeGroupId: varchar('merge_group_id', { length: 64 })
        .references(() => mergeGroups.id, { onDelete: 'set null' }), // 합배송 그룹 참조
    status: taskStatusEnum('status').notNull().default('created'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),

    totalItems: integer('total_items').default(0), // 총 품목 수
    totalQuantity: integer('total_quantity').default(0), // 총 수량

    assignedTo: uuid('assigned_to'), // 작업자 ID
    requiresGiftWrap: boolean('requires_gift_wrap').default(false), // 선물포장 필요
    temperatureControlled: boolean('temperature_controlled').default(false), // 온도 제어 필요

    unavailableReason: unavailableReasonEnum('unavailable_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// 바구니와 주문 연결 테이블 추가
export const outboundTaskOrders = pgTable('outbound_task_orders', {
    taskId: uuid('task_id')
        .references(() => outboundTasks.id, { onDelete: 'cascade' })
        .notNull(),
    orderId: uuid('order_id')
        .references(() => salesOrders.id, { onDelete: 'cascade' })
        .notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.taskId, t.orderId),
}));

// outbound_task_items 수정
export const outboundTaskItems = pgTable('outbound_task_items', {
    taskId: uuid('task_id')
        .references(() => outboundTasks.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),

    quantityPending: integer('quantity_pending').notNull().default(0),
    quantityPicking: integer('quantity_picking').notNull().default(0),
    quantityPicked: integer('quantity_picked').notNull().default(0),

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.taskId, t.skuId),
}));

export const outboundTaskLines = pgTable('outbound_task_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id').references(() => outboundTasks.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    scannedBarcode: varchar('scanned_barcode', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * SHIPMENTS
 *──────────────────────────*/
export const shipments = pgTable('shipments', {
    id: uuid('id').primaryKey().defaultRandom(),
    trackingNo: varchar('tracking_no', { length: 64 }).notNull(),
    status: shipmentStatusEnum('status').notNull().default('created'),
    eta: timestamp('eta', { withTimezone: true }),
    splitStatus: boolean('split_status').notNull().default(false),
    fulfillmentOrderId: uuid('fulfillment_order_id').references(() => fulfillmentOrders.id, { onDelete: 'set null' }),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const shipmentTracking = pgTable('shipment_tracking', {
    id: uuid('id').primaryKey().defaultRandom(),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'cascade' }).notNull(),
    status: shipmentStatusEnum('status').notNull(),
    location: varchar('location', { length: 255 }),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * SALES VARIANT POLICIES
 *──────────────────────────*/
export const salesVariantPolicies = pgTable('sales_variant_policies', {
    variantId: uuid('variant_id').primaryKey(),
    inventoryManagement: boolean('inventory_management').notNull().default(false),
    preStockSellable: boolean('pre_stock_sellable').notNull().default(false),
    alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false),
    fulfillmentMode: fulfillmentModeEnum('fulfillment_mode'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * RETURNS
 *──────────────────────────*/
export const returns = pgTable('returns', {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => salesOrders.id, { onDelete: 'set null' }),
    shipmentId: uuid('shipment_id').references(() => shipments.id, { onDelete: 'set null' }),
    status: returnStatusEnum('status').notNull().default('requested'),
    qcReason: varchar('qc_reason', { length: 255 }),
    restockQuantity: integer('restock_quantity'),
    disposeQuantity: integer('dispose_quantity'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * SETTINGS & HOLIDAYS
 *──────────────────────────*/
export const settings = pgTable('settings', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    key: settingKeyEnum('key').notNull(),
    value: text('value').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const holidays = pgTable('holidays', {
    id: uuid('id').primaryKey().defaultRandom(),
    date: timestamp('date', { mode: 'date' }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isCustom: boolean('is_custom').notNull().default(false),
    source: varchar('source', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * OUTBOX (EVENT DISPATCH)
 *──────────────────────────*/
export const outboxEvents = pgTable('outbox_events', {
    id: uuid('id').primaryKey().defaultRandom(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    partitionKey: varchar('partition_key', { length: 128 }).notNull(),
    payload: json('payload').notNull(),
    status: outboxStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxStatusNext: index('idx_outbox_status_next').on(t.status, t.nextAttemptAt),
}));

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

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const purchaseOrderLines = pgTable('purchase_order_lines', {
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price'), // 단가 추가
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.poId, t.skuId),
}));

/*───────────────────────────
 * PURCHASE ORDER CART
 *──────────────────────────*/
export const purchaseOrderCart = pgTable('purchase_order_cart', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    type: poTypeEnum('type').notNull(),
    supplierInfo: json('supplier_info'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * INBOUND LISTS
 *──────────────────────────*/
export const inboundLists = pgTable('inbound_lists', {
    id: uuid('id').primaryKey().defaultRandom(),
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    barcode: varchar('barcode', { length: 64 }),
    status: inboundStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * INBOUND RECEIPTS (헤더/라인)
 *──────────────────────────*/
export const inboundReceipts = pgTable('inbound_receipts', {
    id: uuid('id').primaryKey().defaultRandom(),
    method: inboundMethodEnum('method').notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    status: inboundReceiptStatusEnum('status').notNull().default('posted'),
    totalQuantity: integer('total_quantity').notNull().default(0),
    journalId: uuid('journal_id').references(() => stockJournals.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxInboundReceiptsWhTime: index('idx_inbound_receipts_wh_time').on(t.warehouseId, t.occurredAt),
}));

export const inboundPlans = pgTable('inbound_plans', {
    id: uuid('id').primaryKey().defaultRandom(),
    expectedDate: timestamp('expected_date', { mode: 'date' }).notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    status: inboundStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxInboundPlansWhDate: index('idx_inbound_plans_wh_date').on(t.warehouseId, t.expectedDate),
}));

export const inboundPlanItems = pgTable('inbound_plan_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id').references(() => inboundPlans.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    expectedQty: integer('expected_qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
    status: inboundStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxInboundPlanItemsPlan: index('idx_inbound_plan_items_plan').on(t.planId),
    idxInboundPlanItemsSku: index('idx_inbound_plan_items_sku').on(t.skuId),
}));

export const inboundReceiptLines = pgTable('inbound_receipt_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id').references(() => inboundReceipts.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
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
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxInboundLinesReceipt: index('idx_inbound_lines_receipt').on(t.receiptId),
    idxInboundLinesSku: index('idx_inbound_lines_sku').on(t.skuId),
}));

/*───────────────────────────
 * INBOUND WORK LOGS (타임라인)
 *──────────────────────────*/
export const inboundWorkLogs = pgTable('inbound_work_logs', {
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
}, t => ({
    idxInboundWorkTime: index('idx_inbound_work_time').on(t.timestamp),
}));

/*───────────────────────────
 * AUDIT LOGS
 *──────────────────────────*/
export const auditLogs = pgTable('audit_logs', {
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
}, t => ({
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
}));

/*───────────────────────────
 * PRODUCT-SKU MAPPING SYSTEM
 *──────────────────────────*/

/**
 * 판매상품→재고상품 매핑 규칙 (현재 활성 매핑)
 */
export const productSkuMappings = pgTable('product_sku_mappings', {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: varchar('product_id', { length: 255 }).notNull(), // PIM의 판매상품 ID
    version: integer('version').notNull().default(1),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).defaultNow(),
    isActive: boolean('is_active').notNull().default(true),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxProductWarehouse: index('idx_product_sku_mappings_product_warehouse').on(t.productId, t.warehouseId),
    idxActiveVersion: index('idx_product_sku_mappings_active').on(t.productId, t.warehouseId, t.isActive),
}));

export const productSkuMappingItems = pgTable('product_sku_mapping_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    mappingId: uuid('mapping_id').references(() => productSkuMappings.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    qtyPerProduct: integer('qty_per_product').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxMapping: index('idx_product_sku_mapping_items_mapping').on(t.mappingId),
}));

/**
 * 주문시점 매핑 스냅샷 (불변)
 */
export const productSkuMappingSnapshots = pgTable('product_sku_mapping_snapshots', {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: varchar('product_id', { length: 255 }).notNull(),
    sourceVersion: integer('source_version').notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }).notNull(),
    snapshotData: json('snapshot_data').notNull(), // { items: [{ skuId, qtyPerProduct }] }
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxProduct: index('idx_product_sku_mapping_snapshots_product').on(t.productId),
}));

/*───────────────────────────
 * FULFILLMENT ORDER ITEMS (FOI) - 핵심 확장
 *──────────────────────────*/

/**
 * 출고주문 아이템 - SO의 판매상품을 SKU로 변환하여 저장
 */
export const fulfillmentOrderItems = pgTable('fulfillment_order_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentOrderId: uuid('fulfillment_order_id')
        .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
        .notNull(),

    // 추적 정보
    salesOrderId: varchar('sales_order_id', { length: 255 }).notNull(), // 원본 SO ID
    salesOrderLineId: varchar('sales_order_line_id', { length: 255 }).notNull(), // 원본 SOL ID
    mappingSnapshotId: uuid('mapping_snapshot_id')
        .references(() => productSkuMappingSnapshots.id, { onDelete: 'restrict' })
        .notNull(),

    // 실제 출고 정보
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    qty: integer('qty').notNull(),

    // 진행 상태
    reservedQty: integer('reserved_qty').notNull().default(0),
    pickedQty: integer('picked_qty').notNull().default(0),
    shippedQty: integer('shipped_qty').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxFulfillmentOrder: index('idx_fulfillment_order_items_fo').on(t.fulfillmentOrderId),
    idxSalesOrder: index('idx_fulfillment_order_items_so').on(t.salesOrderId),
    idxSku: index('idx_fulfillment_order_items_sku').on(t.skuId),
}));

/*───────────────────────────
 * OUTBOUND BATCH SYSTEM
 *──────────────────────────*/

export const outboundBatches = pgTable('outbound_batches', {
    id: uuid('id').primaryKey().defaultRandom(),
    batchNumber: varchar('batch_number', { length: 64 }).notNull().unique(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'restrict' }).notNull(),
    status: batchStatusEnum('status').notNull().default('created'),
    pickingMethod: pickingMethodEnum('picking_method').notNull(),
    cartCapacity: integer('cart_capacity'), // 토탈피킹 시 바구니 수
    assignedTo: varchar('assigned_to', { length: 255 }), // 작업자 ID
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
}, t => ({
    idxWarehouseStatus: index('idx_outbound_batches_warehouse_status').on(t.warehouseId, t.status),
    idxBatchNumber: index('idx_outbound_batches_number').on(t.batchNumber),
}));

export const fulfillmentOrderBatches = pgTable('fulfillment_order_batches', {
    fulfillmentOrderId: uuid('fulfillment_order_id')
        .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
        .notNull(),
    batchId: uuid('batch_id')
        .references(() => outboundBatches.id, { onDelete: 'cascade' })
        .notNull(),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removeReason: varchar('remove_reason', { length: 255 }),
}, t => ({
    pk: primaryKey(t.fulfillmentOrderId, t.batchId),
    idxBatch: index('idx_fulfillment_order_batches_batch').on(t.batchId),
}));

/*───────────────────────────
 * INVOICE MANAGEMENT
 *──────────────────────────*/

export const invoices = pgTable('invoices', {
    id: uuid('id').primaryKey().defaultRandom(),
    fulfillmentOrderId: uuid('fulfillment_order_id')
        .references(() => fulfillmentOrders.id, { onDelete: 'cascade' })
        .notNull(),
    invoiceNumber: varchar('invoice_number', { length: 128 }).notNull().unique(),
    carrierCode: varchar('carrier_code', { length: 32 }),
    issueMethod: invoiceMethodEnum('issue_method').notNull(),
    goodsflowServiceId: varchar('goodsflow_service_id', { length: 255 }),
    status: invoiceStatusEnum('status').notNull().default('issued'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow(),
    printedAt: timestamp('printed_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    idxFulfillmentOrder: index('idx_invoices_fo').on(t.fulfillmentOrderId),
    idxInvoiceNumber: index('idx_invoices_number').on(t.invoiceNumber),
    idxStatus: index('idx_invoices_status').on(t.status),
}));

/*───────────────────────────
 * TABLES ONLY SCHEMA (for TypedDatabase)
 *──────────────────────────*/
export const wmsTables = {
    suppliers,
    holders,
    skus,
    skuSuppliers,
    skuBarcodes,
    categories,
    skuCategories,
    inventoryProductMasters,
    inventoryMasterSkuLinks,
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
    productOptionMatchings,
    salesOrders,
    salesOrderLines,
    orderEvents,
    mergeGroups,
    stockReservations,
    fulfillmentOrders,
    fulfillmentOrderLines,
    outboundTasks,
    outboundTaskOrders,
    outboundTaskItems,
    outboundTaskLines,
    shipments,
    shipmentTracking,
    returns,
    salesVariantPolicies,
    settings,
    holidays,
    purchaseOrders,
    purchaseOrderLines,
    purchaseOrderCart,
    inboundLists,
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

    // FOI 기반 확장 스키마
    productSkuMappings,
    productSkuMappingItems,
    productSkuMappingSnapshots,
    fulfillmentOrderItems,
    outboundBatches,
    fulfillmentOrderBatches,
    invoices,

    // Views
    stockSummary,
} as const;

/*───────────────────────────
 * RELATIONS
 *──────────────────────────*/

import { relations } from 'drizzle-orm';

export const purchaseOrdersRelations = relations(purchaseOrders, ({ one, many }) => ({
    lines: many(purchaseOrderLines),
    supplier: one(suppliers, {
        fields: [purchaseOrders.supplierId],
        references: [suppliers.id],
    }),
}));

export const purchaseOrderLinesRelations = relations(purchaseOrderLines, ({ one }) => ({
    purchaseOrder: one(purchaseOrders, {
        fields: [purchaseOrderLines.purchaseOrderId],
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

// Views schema for queries (includes both tables and views)
export const wmsSchema = {
    ...wmsTables,
    stockSummary,
} as const;