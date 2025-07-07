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
} from 'drizzle-orm/pg-core';

/*───────────────────────────
 * ENUM DECLARATIONS
 *──────────────────────────*/
export const barcodeTypeEnum = pgEnum('barcode_type', ['standard']);
export const sourceTypeEnum = pgEnum('source_type', ['direct', 'in_house', 'overseas']);
export const eventTypeEnum = pgEnum('event_type', ['IN', 'OUT', 'ADJUST', 'MOVE', 'RESERVE', 'CONFIRM', 'RELEASE', 'CANCEL']);
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
export const skus = pgTable('skus', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    defaultBarcode: varchar('default_barcode', { length: 64 }),
    deliveryProfileId: uuid('delivery_profile_id').references(() => deliveryProfiles.id, { onDelete: 'set null' }),
    inventoryManagement: boolean('inventory_management').notNull().default(false),
    sale1m: integer('sale_1m'),
    sale3m: integer('sale_3m'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const skuBarcodes = pgTable('sku_barcodes', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'cascade' }).notNull(),
    barcode: varchar('barcode', { length: 64 }).notNull(),
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

export const carriers = pgTable('carriers', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 128 }).notNull(),
    apiEndpoint: varchar('api_endpoint', { length: 512 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const warehouses = pgTable('warehouses', {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 128 }).notNull(),
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
    xCoordinate: integer('x_coordinate').notNull(),
    yCoordinate: integer('y_coordinate').notNull(),
    width: integer('width'),
    height: integer('height'),
    fifoRank: integer('fifo_rank'),
    isExpirySeparated: boolean('is_expiry_separated'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * STOCK LEDGER
 *──────────────────────────*/
export const stockEvents = pgTable('stock_events', {
    id: uuid('id').primaryKey().default(sql`uuid_v7()`),
    stockId: uuid('stock_id').references(() => stocks.id, { onDelete: 'cascade' }),
    skuId: uuid('sku_id').references(() => skus.id),
    warehouseId: uuid('warehouse_id').references(() => warehouses.id),
    eventType: eventTypeEnum('event_type').notNull(),
    quantity: integer('quantity').notNull(),
    expiryDate: timestamp('expiry_date', { withTimezone: true }),
    manufacturedAt: timestamp('manufactured_at', { withTimezone: true }),
    orderId: uuid('order_id'),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    reason: varchar('reason', { length: 255 }),
    eventTimestamp: timestamp('event_timestamp', { withTimezone: true }).notNull().defaultNow(),
    sequenceNo: integer('sequence_no'),
});

// --- ① stocks (append‑only) ----------------------------------------------
export const stocks = pgTable('stocks', {
    id: uuid('id').primaryKey().defaultRandom(),

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

    /** 이벤트 연결 */
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

// --- ② outbound_task_items -----------------------------------------------
export const outboundTaskItems = pgTable('outbound_task_items', {
    taskId: uuid('task_id')
        .references(() => outboundTasks.id, { onDelete: 'cascade' })
        .notNull(),
    skuId: uuid('sku_id')
        .references(() => skus.id)
        .notNull(),

    qtyPending: integer('qty_pending').notNull().default(0),  // 출고대기
    qtyPicking: integer('qty_picking').notNull().default(0),  // 카트 담김
    qtyPicked: integer('qty_picked').notNull().default(0),   // 박스 완료

    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, t => ({
    pk: primaryKey(t.taskId, t.skuId),
}));


/*───────────────────────────
 * PRODUCT / SKU MAPPING
 *──────────────────────────*/
export const productMatchings = pgTable('product_matchings', {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id').notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'set null' }),
    variantId: uuid('variant_id'),
    status: matchingStatusEnum('status').notNull().default('pending'),
    priority: matchingPriorityEnum('priority').notNull().default('normal'),
    isResolved: boolean('is_resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * RESERVATIONS
 *──────────────────────────*/
export const stockReservations = pgTable('stock_reservations', {
    reservationId: uuid('reservation_id').primaryKey().defaultRandom(),
    orderId: uuid('order_id'),
    stockId: uuid('stock_id').references(() => stocks.id, { onDelete: 'restrict' }).notNull(),
    qty: integer('qty').notNull(),
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
    qty: integer('qty').notNull(),
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
    carrierId: uuid('carrier_id').references(() => carriers.id).notNull(),
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
    restockQty: integer('restock_qty'),
    disposeQty: integer('dispose_qty'),
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
    id: uuid('po_id').primaryKey().defaultRandom(),
    type: poTypeEnum('type').notNull(),
    expectedArrival: timestamp('expected_arrival', { mode: 'date' }),
    status: poStatusEnum('status').notNull().default('created'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const purchaseOrderLines = pgTable('purchase_order_lines', {
    poId: uuid('po_id').references(() => purchaseOrders.id, { onDelete: 'cascade' }).notNull(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    qty: integer('qty').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
},
    (t) => ({
        pk: primaryKey(t.poId, t.skuId),
    }));

/*───────────────────────────
 * PURCHASE ORDER CART
 *──────────────────────────*/
export const purchaseOrderCart = pgTable('purchase_order_cart', {
    id: uuid('id').primaryKey().defaultRandom(),
    skuId: uuid('sku_id').references(() => skus.id, { onDelete: 'restrict' }).notNull(),
    qty: integer('qty').notNull(),
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
    qty: integer('qty').notNull(),
    barcode: varchar('barcode', { length: 64 }),
    status: inboundStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

/*───────────────────────────
 * TABLES ONLY SCHEMA (for TypedDatabase)
 *──────────────────────────*/
export const wmsTables = {
    skus,
    skuBarcodes,
    categories,
    skuCategories,
    deliveryProfiles,
    carriers,
    warehouses,
    locations,
    stockEvents,
    stocks,
    outboundTaskItems,
    productMatchings,
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