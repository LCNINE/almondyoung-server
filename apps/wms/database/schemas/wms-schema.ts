// apps/wms/database/schemas/wms-schema.ts
import { sql } from 'drizzle-orm';
import {
    pgTable,
    uuid,
    varchar,
    boolean,
    integer,
    timestamp,
    json,
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
    "RESERVED_SALES",  // 판매 예약
    "RESERVED_MOVE",   // 이동 작업 예약
    "DEFECTIVE",       // 불량
    "IN_TRANSFER",     // 창고간 운송중
]);
/** 상태 전이 타입(enum) */
export const transitionTypeEnum = pgEnum("transition_type", [
    // 입고/정정
    "RECEIVE",                 // null → ON_HAND
    "RECEIPT_CORRECTION_UP",   // (정정 +Δ) null → ON_HAND
    "RECEIPT_CORRECTION_DOWN", // (정정 −Δ) ON_HAND → null  (= RECEIPT_REV0ERSAL의 친절한 별칭)
    "RECEIPT_REVERSAL",        // ON_HAND → null (원입고 상쇄)
  
    // 판매 예약/출고
    "RESERVE_SALES",           // ON_HAND → RESERVED_SALES
    "UNRESERVE_SALES",         // RESERVED_SALES → ON_HAND
    "SHIP",                    // RESERVED_SALES (또는 정책상 ON_HAND) → null
    "SHIP_REVERSAL",           // null → ON_HAND (출고 취소/반품 즉시 재가용)
  
    // 로케이션 이동(동일 창고 내)
    "MOVE_RESERVE",            // ON_HAND(A) → RESERVED_MOVE(A)  (이동 시작: 가용 잠금)
    "MOVE_CANCEL",             // RESERVED_MOVE(A) → ON_HAND(A)  (이동 취소)
    "MOVE_COMMIT",             // RESERVED_MOVE(A) → ON_HAND(B)  (이동 확정: 목적지 반영)
    "MOVE_INSTANT",            // ON_HAND(A) → ON_HAND(B)        (예약 없이 즉시 이동)
  
    // 창고 간 이동(인터-웨어하우스)
    "TRANSFER_SHIP",           // ON_HAND(src) → IN_TRANSFER(src)    (출발 창고 선적)
    "TRANSFER_RECEIVE",        // IN_TRANSFER(dst) → ON_HAND(dst)     (도착 창고 입고)
    "TRANSFER_CANCEL_SHIP",    // IN_TRANSFER(src) → ON_HAND(src)     (선적 취소/반송)
    "TRANSFER_LOSS",           // IN_TRANSFER(*) → SCRAPPED           (운송 중 분실)
    "TRANSFER_DAMAGE",         // IN_TRANSFER(*) → DEFECTIVE          (운송 중 파손)
  
    // 품질/검수
    "MARK_DEFECT",             // ON_HAND → DEFECTIVE
    "REWORK_GOOD",             // DEFECTIVE → ON_HAND
    "QUARANTINE_HOLD",         // ON_HAND → QUARANTINE
    "QUARANTINE_RELEASE",      // QUARANTINE → ON_HAND
  
    // 조정/폐기
    "ADJUST_UP",               // null → ON_HAND        (재고 발견/실사 가산)
    "ADJUST_DOWN",             // ON_HAND → null        (감모/실사 차감)
    "SCRAP",                   // (ON_HAND|DEFECTIVE 등) → SCRAPPED
    "UNSCRAP"                  // SCRAPPED → ON_HAND    (잘못 폐기 처리 복원; 운영 정책에 따라 제외 가능)
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
    optionKey: json('option_key'),
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
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
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
export const stockSummary = pgTable('stock_summary', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),
    warehouseId: uuid('warehouse_id')
        .references(() => warehouses.id, { onDelete: 'cascade' })
        .notNull(),

    currentQuantity: integer('current_quantity').notNull().default(0),
    availableQuantity: integer('available_quantity').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),

    // 상태별 재고 현황
    inboundPendingQuantity: integer('inbound_pending_quantity').notNull().default(0),
    outboundPendingQuantity: integer('outbound_pending_quantity').notNull().default(0),
    movingQuantity: integer('moving_quantity').notNull().default(0),
    damageQuantity: integer('damage_quantity').notNull().default(0),
    returnPendingQuantity: integer('return_pending_quantity').notNull().default(0),

    lastEventId: uuid('last_event_id').references(() => stockEvents.id),
    lastUpdated: timestamp('last_updated', { withTimezone: true }).defaultNow(),
    version: integer('version').notNull().default(1),

}, t => ({
    uniqueSkuWarehouse: unique().on(t.skuId, t.warehouseId),
    skuIdx: index('stock_summary_sku_idx').on(t.skuId),
    warehouseIdx: index('stock_summary_warehouse_idx').on(t.warehouseId),
}));

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

    // 사은품 플래그 추가
    isGift: boolean('is_gift').notNull().default(false), //사은품 여부

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
export const orders = pgTable('orders', {
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
export const orderItems = pgTable('order_items', {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
        .references(() => orders.id, { onDelete: 'cascade' })
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
        .references(() => orders.id, { onDelete: 'cascade' })
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

/*───────────────────────────
 * RESERVATIONS
 *──────────────────────────*/
export const stockReservations = pgTable('stock_reservations', {
    reservationId: uuid('reservation_id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
        .references(() => orders.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    quantity: integer('quantity').notNull(),
    status: reservationStatusEnum('status').notNull().default('pending'),
    timeoutAt: timestamp('timeout_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

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
        .references(() => orders.id, { onDelete: 'cascade' })
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
 * RETURNS
 *──────────────────────────*/
export const returns = pgTable('returns', {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
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
 * PURCHASE ORDERS
 *──────────────────────────*/
export const purchaseOrders = pgTable('purchase_orders', {
    id: uuid('id').primaryKey().defaultRandom(),
    type: poTypeEnum('type').notNull(),
    supplierId: uuid('supplier_id').references(() => suppliers.id), // 공급사 참조 추가
    expectedArrival: timestamp('expected_arrival', { mode: 'date' }),
    status: poStatusEnum('status').notNull().default('created'),
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
    stockSummary,
    productMatchings,
    productVariantSkuLinks,
    productOptionMatchings,
    orders,
    orderItems,
    orderEvents,
    mergeGroups,
    stockReservations,
    outboundTasks,
    outboundTaskOrders,
    outboundTaskItems,
    outboundTaskLines,
    shipments,
    shipmentTracking,
    returns,
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
} as const;