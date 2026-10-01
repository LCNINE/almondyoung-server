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
  primaryKey,
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
    /** 게시 시점 매입 원가(공급가, 원). null = 원가 미입력 — 마진은 "계산 불가"로 구분한다. */
    supplyPrice: bigint('supply_price', { mode: 'number' }),
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
    // 카테고리 표시명. 이벤트에는 없어 시딩 스크립트(scripts/ops/seed-analytics-product-dims.ts)가 채운다.
    categoryName: varchar('category_name', { length: 255 }),
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

/**
 * 월 고정비(임대·인건비·마케팅 등 매출과 무관하게 나가는 돈). 이벤트가 아니라 **관리자 입력값**이다 —
 * 시스템 어디에도 원천이 없어서 손익분기·"이대로 가면 흑자인가"를 못 물어보던 공백을 메운다.
 * 손익을 계산하는 곳이 이 서비스라 여기 둔다. 집계 파이프라인과는 무관한 설정 테이블이며,
 * 소비자·아웃박스가 이 표를 쓰지 않는다.
 * 수정이 아니라 새 적용일 행을 쌓아 이력을 보존한다 — 과거 기간의 손익이 나중 입력으로 바뀌면 안 된다.
 *
 * **항목별(임대료·인건비·광고비) 분해를 일부러 하지 않았다.** 커머스 손익 도구들(TrueProfit 등)은
 * 항목명을 받지만, 그건 복식부기 없는 미니 회계가 되어 나중에 들어올 회계 모듈과 이중 원천이 된다.
 * 여기서는 판정용 파라미터로만 쓰고 합계 하나만 받는다.
 * **승격 경로**: 회계 모듈이 들어오면 이 표를 사람이 입력하는 대신 비용 원장에서 읽도록 바꾼다 —
 * 지우는 범위는 이 표 1개 + CRUD 1개 + 설정 화면 1개다.
 */
export const settingOperatingCosts = pgTable(
  'setting_operating_costs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** 원 단위 월 고정비 합계. 항목별 분해는 지금 필요가 없어 합계 하나만 받는다. */
    monthlyFixedCost: bigint('monthly_fixed_cost', { mode: 'number' }).notNull(),
    /** 적용 시작일 (KST 달력일). 이 날부터 다음 행의 적용일 전날까지 이 값을 쓴다. */
    effectiveFrom: date('effective_from').notNull(),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => [uniqueIndex('uq_setting_operating_costs_effective').on(table.effectiveFrom)],
);

/**
 * 연간 매출 목표. 고정비와 같은 **관리자 입력값**이고 같은 이유로 여기 둔다.
 * 수정하지 않고 새 행을 쌓는다 — 그 해의 «현재 목표»는 가장 늦게 만든 행이고, 앞의 행은 이력이다.
 * 삭제하면 직전 행이 다시 현재 목표가 된다.
 *
 * 목표 금액의 정의는 «전 채널 순매출»(매출 탭과 같은 총매출 − 취소 − 환불)이다. 화면이 wallet 상품 환불을
 * 추가로 차감한다 — 이 표는 금액만 담고 정의를 담지 않는다.
 */
export const settingRevenueGoals = pgTable(
  'setting_revenue_goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    year: integer('year').notNull(),
    /**
     * 목표 범위. 'own_mall' = 자사몰 순매출, 'all_channels' = 집계에 들어온 전 판매채널 순매출.
     * 외부 채널이 집계에 없으면 두 값이 같아지므로 화면은 외부 채널 데이터가 있을 때만 'all_channels' 를 열어 준다.
     */
    scope: varchar('scope', { length: 20 }).notNull().default('own_mall'),
    annualTarget: bigint('annual_target', { mode: 'number' }).notNull(),
    /**
     * 집계가 시작되기 전(그 해 1월 1일 ~ 집계 첫날 전날)의 실적을 관리자가 직접 넣은 값. 없으면 null —
     * 그때 화면은 달성률을 «집계 시작일부터» 기준으로 내고 그 사실을 표기한다. 0 으로 뭉개지 않는다.
     */
    preCoverageActual: bigint('pre_coverage_actual', { mode: 'number' }),
    /** 계획 도우미(바텀업)로 만든 목표면 그때의 가정(세션·전환율·객단가 등). 직접 입력이면 null. */
    planAssumptions: jsonb('plan_assumptions'),
    memo: varchar('memo', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_setting_revenue_goals_year_created').on(table.year, table.createdAt)],
);

/** 목표의 월별 배분. 12행이 한 목표에 딸리고, 합이 연간 목표와 같아야 한다(서비스가 검증한다). */
export const settingRevenueGoalMonths = pgTable(
  'setting_revenue_goal_months',
  {
    goalId: uuid('goal_id')
      .notNull()
      .references(() => settingRevenueGoals.id, { onDelete: 'cascade' }),
    month: integer('month').notNull(),
    target: bigint('target', { mode: 'number' }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.goalId, table.month] })],
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
  settingOperatingCosts,
  settingRevenueGoals,
  settingRevenueGoalMonths,
} as const;

export type AnalyticsSchema = typeof analyticsSchema;
