import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  integer,
  bigint,
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
    customerId: varchar('customer_id', { length: 255 }),
    orderItemId: varchar('order_item_id', { length: 255 }),
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
    index('idx_fact_order_items_customer').on(table.customerId),
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
    grossRevenue: bigint('gross_revenue', { mode: 'number' }).notNull().default(0),
    cancelledAmount: bigint('cancelled_amount', { mode: 'number' }).notNull().default(0),
    refundedAmount: bigint('refunded_amount', { mode: 'number' }).notNull().default(0),
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

export const aggUserProductPurchase = pgTable(
  'agg_user_product_purchase',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    customerId: varchar('customer_id', { length: 255 }).notNull(),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    channelProductId: varchar('channel_product_id', { length: 255 }),
    purchaseCount: integer('purchase_count').notNull().default(0),
    totalQuantity: integer('total_quantity').notNull().default(0),
    lastPurchasedAt: timestamp('last_purchased_at'),
    firstPurchasedAt: timestamp('first_purchased_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_user_product').on(table.customerId, table.masterId),
    index('idx_agg_user_product_customer').on(table.customerId),
    index('idx_agg_user_product_master').on(table.masterId),
    index('idx_agg_user_product_count').on(table.purchaseCount),
  ],
);

export const aggChannelDaily = pgTable(
  'agg_channel_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    ordersCount: integer('orders_count').notNull().default(0),
    grossRevenue: bigint('gross_revenue', { mode: 'number' }).notNull().default(0),
    cancelledAmount: bigint('cancelled_amount', { mode: 'number' }).notNull().default(0),
    refundedAmount: bigint('refunded_amount', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_channel_daily').on(table.aggDate, table.salesChannel),
    index('idx_agg_channel_daily_date').on(table.aggDate),
  ],
);

export const aggVariantOrderDaily = pgTable(
  'agg_variant_order_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    variantId: varchar('variant_id', { length: 255 }).notNull(),
    masterId: varchar('master_id', { length: 255 }).notNull(),
    salesChannel: varchar('sales_channel', { length: 50 }).notNull(),
    quantitySold: integer('quantity_sold').notNull().default(0),
    grossRevenue: bigint('gross_revenue', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_variant_order_daily').on(table.aggDate, table.variantId, table.salesChannel),
    index('idx_agg_variant_order_daily_date').on(table.aggDate),
    index('idx_agg_variant_order_daily_master').on(table.masterId),
  ],
);

export const aggCustomerLifetime = pgTable(
  'agg_customer_lifetime',
  {
    customerId: varchar('customer_id', { length: 255 }).primaryKey(),
    firstOrderAt: timestamp('first_order_at'),
    lastOrderAt: timestamp('last_order_at'),
    ordersCount: integer('orders_count').notNull().default(0),
    totalRevenue: bigint('total_revenue', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [index('idx_agg_customer_lifetime_first_order').on(table.firstOrderAt)],
);

export const factMembershipEvents = pgTable(
  'fact_membership_events',
  {
    messageId: varchar('message_id', { length: 26 }).primaryKey(),
    userId: varchar('user_id', { length: 255 }).notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    tierId: varchar('tier_id', { length: 255 }),
    planId: varchar('plan_id', { length: 255 }),
    contractId: varchar('contract_id', { length: 255 }),
    reasonCode: varchar('reason_code', { length: 100 }),
    reasonText: text('reason_text'),
    occurredAt: timestamp('occurred_at').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [
    index('idx_fact_membership_events_user').on(table.userId),
    index('idx_fact_membership_events_occurred_at').on(table.occurredAt),
    index('idx_fact_membership_events_status').on(table.status),
    index('idx_fact_membership_events_reason').on(table.reasonCode),
  ],
);

export const dimCustomerMembership = pgTable(
  'dim_customer_membership',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    userId: varchar('user_id', { length: 255 }).notNull(),
    tierId: varchar('tier_id', { length: 255 }).notNull().default('UNKNOWN'),
    contractId: varchar('contract_id', { length: 255 }),
    validFrom: timestamp('valid_from').notNull(),
    validTo: timestamp('valid_to'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_dim_customer_membership').on(table.userId, table.validFrom),
    index('idx_dim_customer_membership_user').on(table.userId),
    index('idx_dim_customer_membership_valid_to').on(table.validTo),
  ],
);

export const aggMembershipDaily = pgTable(
  'agg_membership_daily',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    aggDate: date('agg_date').notNull(),
    status: varchar('status', { length: 30 }).notNull(),
    tierId: varchar('tier_id', { length: 255 }).notNull().default('UNKNOWN'),
    membersCount: integer('members_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_agg_membership_daily').on(table.aggDate, table.status, table.tierId),
    index('idx_agg_membership_daily_date').on(table.aggDate),
  ],
);

export const analyticsSchema = {
  factOrderEvents,
  factOrderItems,
  aggProductOrderDaily,
  aggUserProductPurchase,
  aggChannelDaily,
  aggVariantOrderDaily,
  aggCustomerLifetime,
  factMembershipEvents,
  dimCustomerMembership,
  aggMembershipDaily,
  dimProductMasters,
  dimProductVariants,
  dimProductCategories,
} as const;

export type AnalyticsSchema = typeof analyticsSchema;
