import { pgTable, uuid, varchar, text, boolean, integer, timestamp, index, unique, jsonb } from 'drizzle-orm/pg-core';
import { type InferSelectModel } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

export type PrintOrderStatus =
  | 'pending'
  | 'submitting'
  | 'submitted'
  | 'shipped'
  | 'delivered'
  | 'failed'
  | 'unsupported'
  | 'cancelling'
  | 'cancelled'
  | 'cancel_refused';

// sales_orders 와 순환 import 가 되지 않게 FK 를 두지 않는다 (inventory.schema 가 이 테이블을 wmsTables 에 싣는다).
export const printOrders = pgTable(
  'print_orders',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    salesOrderId: uuid('sales_order_id').notNull(),
    salesOrderLineId: uuid('sales_order_line_id').notNull(),
    almondDesignId: uuid('almond_design_id').notNull(),
    vendor: varchar('vendor', { length: 16 }).notNull().default('wowpress'),
    status: varchar('status', { length: 16 }).$type<PrintOrderStatus>().notNull().default('pending'),
    testMemo: boolean('test_memo').notNull().default(false),
    vendorOrderNumber: varchar('vendor_order_number', { length: 64 }),
    vendorBoxNumber: varchar('vendor_box_number', { length: 32 }),
    vendorShippingFee: integer('vendor_shipping_fee'),
    attemptCount: integer('attempt_count').notNull().default(0),
    lastError: text('last_error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    submittingAt: timestamp('submitting_at', { withTimezone: true }),
    orderAttemptedAt: timestamp('order_attempted_at', { withTimezone: true }),
    carrier: varchar('carrier', { length: 16 }),
    trackingNumber: varchar('tracking_number', { length: 64 }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    testConfirmedAt: timestamp('test_confirmed_at', { withTimezone: true }),
    testConfirmedBy: uuid('test_confirmed_by'),
    testNote: text('test_note'),
    cancelRefusedAt: timestamp('cancel_refused_at', { withTimezone: true }),
    cancelResolvedAt: timestamp('cancel_resolved_at', { withTimezone: true }),
    cancelResolvedBy: uuid('cancel_resolved_by'),
    salesCancelFailedAt: timestamp('sales_cancel_failed_at', { withTimezone: true }),
    fileDeliveredAt: timestamp('file_delivered_at', { withTimezone: true }),
    vendorAwaitingPayment: boolean('vendor_awaiting_payment').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueLine: unique('uq_print_orders_sales_order_line').on(t.salesOrderLineId),
    idxSalesOrder: index('ix_print_orders_sales_order').on(t.salesOrderId),
    idxStatusNext: index('idx_print_orders_status_next_attempt').on(t.status, t.nextAttemptAt),
  }),
);

export type PrintOrderRow = InferSelectModel<typeof printOrders>;

export type PrintFileFormat = 'jpg' | 'pdf' | 'eps';

// 변형(variant)별 와우프레스 발주 사양. 없으면 코드 상수 WOWPRESS_PRODUCTS 로 떨어진다
export const printProductSpecs = pgTable('print_product_specs', {
  variantId: uuid('variant_id').primaryKey(),
  prodno: integer('prodno').notNull(),
  jobpresetno: text('jobpresetno').notNull(),
  prsjob: jsonb('prsjob').$type<Record<string, unknown>[]>().notNull(),
  awkjob: jsonb('awkjob').$type<Record<string, unknown>[]>().notNull(),
  qtyPerUnit: integer('qty_per_unit').notNull(),
  fileFormat: text('file_format').$type<PrintFileFormat>().notNull(),
  fileDpi: integer('file_dpi').notNull(),
  designProductId: varchar('design_product_id', { length: 36 }).notNull(),
  designWidthMm: integer('design_width_mm').notNull(),
  designHeightMm: integer('design_height_mm').notNull(),
  confirmed: boolean('confirmed').notNull().default(false),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  confirmedBy: text('confirmed_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PrintProductSpecRow = InferSelectModel<typeof printProductSpecs>;

export const printTemplateProducts = pgTable('print_template_products', {
  templateId: uuid('template_id').primaryKey(),
  masterId: uuid('master_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const printOrderSchema = { printOrders, printProductSpecs, printTemplateProducts } as const;
