import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  text,
  date,
  boolean,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export const factOrderEvents = pgTable(
  'fact_order_events',
  {
    messageId: varchar('message_id', { length: 26 }).primaryKey(),
    messageType: varchar('message_type', { length: 100 }).notNull(),
    messageVersion: integer('message_version').notNull().default(1),
    messageKind: varchar('message_kind', { length: 20 }).notNull(),
    correlationId: varchar('correlation_id', { length: 26 }).notNull(),
    causationId: varchar('causation_id', { length: 26 }),
    aggregateType: varchar('aggregate_type', { length: 50 }),
    aggregateId: varchar('aggregate_id', { length: 255 }),
    sourceService: varchar('source_service', { length: 100 }),
    salesChannel: varchar('sales_channel', { length: 50 }),
    orderId: varchar('order_id', { length: 255 }),
    externalOrderId: varchar('external_order_id', { length: 255 }),
    occurredAt: timestamp('occurred_at'),
    payload: jsonb('payload').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_fact_order_events_type').on(table.messageType),
    index('idx_fact_order_events_occurred_at').on(table.occurredAt),
    index('idx_fact_order_events_order').on(table.orderId),
    index('idx_fact_order_events_external_order').on(table.externalOrderId),
  ],
);

export const factOrderItems = pgTable(
  'fact_order_items',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    messageId: varchar('message_id', { length: 26 }).notNull(),
    orderKey: varchar('order_key', { length: 255 }).notNull(),
    orderId: varchar('order_id', { length: 255 }),
    externalOrderId: varchar('external_order_id', { length: 255 }),
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    orderItemId: varchar('order_item_id', { length: 255 }).notNull(),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    versionId: varchar('version_id', { length: 255 }),
    variantId: varchar('variant_id', { length: 255 }),
    skuId: varchar('sku_id', { length: 255 }),
    productName: text('product_name'),
    channelProductId: varchar('channel_product_id', { length: 255 }),
    quantity: integer('quantity').notNull(),
    unitPrice: integer('unit_price'),
    totalPrice: integer('total_price'),
    currency: varchar('currency', { length: 10 }),
    occurredAt: timestamp('occurred_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_fact_order_items_order_item').on(table.orderKey, table.salesChannel, table.orderItemId),
    index('idx_fact_order_items_master').on(table.masterId),
    index('idx_fact_order_items_occurred_at').on(table.occurredAt),
    index('idx_fact_order_items_order_key').on(table.orderKey),
  ],
);

export const aggProductOrderDaily = pgTable(
  'agg_product_order_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    quantitySold: integer('quantity_sold').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_product_order_daily').on(table.aggDate, table.masterId, table.salesChannel),
    index('idx_agg_product_order_daily_date').on(table.aggDate),
    index('idx_agg_product_order_daily_master').on(table.masterId),
    index('idx_agg_product_order_daily_channel').on(table.salesChannel),
  ],
);

export const dimProductMasters = pgTable(
  'dim_product_masters',
  {
    masterId: varchar('master_id', { length: 255 }).primaryKey(),
    name: text('name'),
    activeVersionId: varchar('active_version_id', { length: 255 }),
    isActive: boolean('is_active'),
    lastChangeReason: varchar('last_change_reason', { length: 50 }),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    deletedAt: timestamp('deleted_at'),
    lastEventAt: timestamp('last_event_at'),
  },
  (table) => [
    index('idx_dim_product_masters_active').on(table.isActive),
    index('idx_dim_product_masters_name').on(table.name),
    index('idx_dim_product_masters_updated_at').on(table.updatedAt),
  ],
);

export const dimProductVariants = pgTable(
  'dim_product_variants',
  {
    variantId: varchar('variant_id', { length: 255 }).primaryKey(),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    versionId: varchar('version_id', { length: 255 }).notNull(),
    variantName: text('variant_name'),
    isDefault: boolean('is_default'),
    status: varchar('status', { length: 20 }),
    inventoryManagement: boolean('inventory_management'),
    preStockSellable: boolean('pre_stock_sellable'),
    alwaysSellableZeroStock: boolean('always_sellable_zero_stock'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
    deletedAt: timestamp('deleted_at'),
    lastEventAt: timestamp('last_event_at'),
  },
  (table) => [
    index('idx_dim_product_variants_master').on(table.masterId),
    index('idx_dim_product_variants_status').on(table.status),
    index('idx_dim_product_variants_updated_at').on(table.updatedAt),
  ],
);

export const dimProductCategories = pgTable(
  'dim_product_categories',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    categoryId: varchar('category_id', { length: 255 }).notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_dim_product_categories_master_category').on(table.masterId, table.categoryId),
    index('idx_dim_product_categories_master').on(table.masterId),
    index('idx_dim_product_categories_category').on(table.categoryId),
    index('idx_dim_product_categories_primary').on(table.isPrimary),
  ],
);

export const analyticsSchema = {
  factOrderEvents,
  factOrderItems,
  aggProductOrderDaily,
  dimProductMasters,
  dimProductVariants,
  dimProductCategories,
} as const;

export type AnalyticsSchema = typeof analyticsSchema;
