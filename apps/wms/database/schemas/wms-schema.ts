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
} from 'drizzle-orm/pg-core';

/*───────────────────────────
 * ENUM DECLARATIONS
 *──────────────────────────*/
export const barcodeTypeEnum = pgEnum('barcode_type', ['standard']);
export const sourceTypeEnum = pgEnum('source_type', ['direct', 'in_house', 'overseas']);

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
export const settingKeyEnum = pgEnum('setting_key', ['use_sub_barcode', 'use_expiry_separation']);
export const poTypeEnum = pgEnum('po_type', ['domestic', 'foreign']);
export const poStatusEnum = pgEnum('po_status', ['created', 'confirmed', 'received']);
export const inboundStatusEnum = pgEnum('inbound_status', ['pending', 'confirmed']);
export const stockTypeEnum = pgEnum('stock_type', ['physical', 'infinite', 'drop_shipped', 'consignment']);

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

export const skus = pgTable('skus', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    code: varchar('code', { length: 64 }).notNull().unique(),
    defaultBarcode: varchar('default_barcode', { length: 64 }), // SKU의 기본 바코드 (skuBarcodes에서 관리, 자동생성됨)
    deliveryProfileId: uuid('delivery_profile_id').references(() => deliveryProfiles.id, { onDelete: 'set null' }),
    inventoryManagement: boolean('inventory_management').notNull().default(false), // true: 물리적 재고 관리, false: 디지털
    preStockSellable: boolean('pre_stock_sellable').notNull().default(true), // 재고 0이어도 선판매 가능한지 여부 (default true로 변경)
    alwaysSellableZeroStock: boolean('always_sellable_zero_stock').notNull().default(false), // 재고 0이어도 항상 판매 가능한 상품 (직배/신상품)
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
export const locations = pgTable('locations', {
    id: uuid('id').primaryKey().defaultRandom(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id, { onDelete: 'cascade' }).notNull(),
    code: varchar('code', { length: 64 }).notNull(), // 로케이션 코드 추가 (예: A-1-1)
    xCoordinate: integer('x_coordinate').notNull(),
    yCoordinate: integer('y_coordinate').notNull(),
    width: integer('width'),
    height: integer('height'),
    fifoRank: integer('fifo_rank'),
    isExpirySeparated: boolean('is_expiry_separated'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uniqueCodePerWarehouse: unique().on(t.warehouseId, t.code), // 창고별 로케이션 코드 유니크
}));

/*───────────────────────────
 * STOCK LEDGER
 *──────────────────────────*/
export const stockEvents = pgTable('stock_events', {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    stockId: uuid('stock_id').references(() => stocks.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id').references(() => skus.id).notNull(),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
    eventType: eventTypeEnum('event_type').notNull(),
    quantity: integer('quantity').notNull(),

    // 창고 간 이동 시 사용
    fromWarehouseId: uuid('from_warehouse_id').references(() => warehouses.id),
    toWarehouseId: uuid('to_warehouse_id').references(() => warehouses.id),

    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    manufacturedAt: timestamp('manufactured_at', { withTimezone: true }),
    orderId: uuid('order_id'),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    reason: varchar('reason', { length: 255 }),
    eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).notNull().defaultNow(),
    sequenceNo: integer('sequence_no'),
    createsStockRowId: uuid('creates_stock_row_id').references(() => stocks.id),
    expiresStockRowId: uuid('expires_stock_row_id').references(() => stocks.id),
});

// stocks (append‑only)
export const stocks = pgTable('stocks', {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),

    /* FK */
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'restrict' })
        .notNull(),
    warehouseId: uuid('warehouse_id')
        .references(() => warehouses.id)
        .notNull(),
    locationId: uuid('location_id')
        .references(() => locations.id, { onDelete: 'set null' }),
    stockType: stockTypeEnum('stock_type').notNull().default('physical'),

    /** 수량 */
    realQuantity: integer('real_quantity').notNull(),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    availableQuantity: integer('available_quantity').notNull(),
    safetyStock: integer('safety_stock'),

    creatorEventId: uuid('creator_event_id')
        .references(() => stockEvents.id)
        .notNull(),
    destroyerEventId: uuid('destroyer_event_id')
        .references(() => stockEvents.id),

    /** 메타 */
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    manufacturedAt: timestamp('manufactured_at', { withTimezone: true }),
    barcodeType: barcodeTypeEnum('barcode_type'),
    subBarcode: varchar('sub_barcode', { length: 64 }),
    packingUnit: varchar('packing_unit', { length: 64 }),
});

// outbound_task_items
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

/*───────────────────────────
 * PRODUCT / VARIANT / SKU MAPPING
 *──────────────────────────*/
export const productMatchings = pgTable('product_matchings', {
    id: uuid('id').primaryKey().defaultRandom(),
    variantId: uuid('variant_id').notNull(), // PIM의 Variant ID
    status: matchingStatusEnum('status').notNull().default('pending'), // 매칭 상태 (pending, matched, ignored)
    priority: matchingPriorityEnum('priority').notNull().default('normal'), // 매칭 우선순위
    isResolved: boolean('is_resolved').notNull().default(false), // 매칭이 해결되었는지
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    uniqueVariantId: unique().on(t.variantId), // variant당 하나의 매칭만 존재
}));

// product_variant_sku_links: variant와 sku의 N:M 관계를 위한 연결 테이블
export const productVariantSkuLinks = pgTable('product_variant_sku_links', {
    productMatchingId: uuid('product_matching_id')
        .references(() => productMatchings.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id')
        .references(() => skus.id, { onDelete: 'cascade' })
        .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.productMatchingId, t.skuId),
}));

/*───────────────────────────
 * RESERVATIONS
 *──────────────────────────*/
export const stockReservations = pgTable('stock_reservations', {
    reservationId: uuid('reservation_id').primaryKey().defaultRandom(),
    orderId: uuid('order_id'),
    stockId: uuid('stock_id').references(() => stocks.id, { onDelete: 'restrict' }).notNull(),
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
    orderId: uuid('order_id'),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id).notNull(),
    status: taskStatusEnum('status').notNull().default('created'),
    unavailableReason: unavailableReasonEnum('unavailable_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const outboundTaskLines = pgTable('outbound_task_lines', {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id').references(() => outboundTasks.id, { onDelete: 'cascade' }).notNull(),
    stockId: uuid('stock_id').references(() => stocks.id, { onDelete: 'restrict' }).notNull(),
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
    orderId: uuid('order_id'),
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
 * TABLES ONLY SCHEMA (for TypedDatabase)
 *──────────────────────────*/
export const wmsTables = {
    suppliers,
    skus,
    skuSuppliers,
    skuBarcodes,
    categories,
    skuCategories,
    deliveryProfiles,
    warehouses,
    locations,
    stockEvents,
    stocks,
    outboundTaskItems,
    productMatchings,
    productVariantSkuLinks,
    stockReservations,
    outboundTasks,
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
} as const;