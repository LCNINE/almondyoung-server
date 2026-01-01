import { integer, pgTable, uuid, text, timestamp, jsonb, boolean, varchar, uniqueIndex, index } from "drizzle-orm/pg-core"


const timestampColumns = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),

    productId: uuid('product_id').notNull(),

    rating: integer('rating').notNull(),
    content: text('content').notNull(),

    status: varchar('status', { length: 20 }).notNull().default('active'),

    sourceSystem: varchar('source_system', { length: 30 }).notNull().default('almondyoung'),

    legacyAuthorName: varchar('legacy_author_name', { length: 100 }),
    legacyMemberId: varchar('legacy_member_id', { length: 100 }),
    legacySourceReviewId: integer('legacy_source_review_id'), // article_no
    legacySourceOrderId: varchar('legacy_source_order_id', { length: 50 }),
    legacyImportedAt: timestamp('legacy_imported_at'),
    legacyPayload: jsonb('legacy_payload'),

    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('reviews_legacy_source_unique').on(table.sourceSystem, table.legacySourceReviewId),
    index('reviews_product_id').on(table.productId),
    index('reviews_user_id').on(table.userId),
    index('reviews_created_at').on(table.createdAt),
  ],
);

export const reviewEligibilities = pgTable(
  'review_eligibilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    productId: uuid('product_id').notNull(),
    orderId: uuid('order_id').notNull(),
    orderLineId: uuid('order_line_id').notNull(),

    eligibleAt: timestamp('eligible_at').notNull().defaultNow(),
    consumedAt: timestamp('consumed_at'),
    consumedByReviewId: uuid('consumed_by_review_id').references(() => reviews.id, {
      onDelete: 'set null',
    }),

    sourceSystem: varchar('source_system', { length: 30 }).notNull().default('almondyoung'),
    sourceEventId: varchar('source_event_id', { length: 255 }),

    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('review_eligibilities_source_unique').on(
      table.sourceSystem,
      table.sourceEventId,
    ),
    uniqueIndex('review_eligibilities_order_line_unique').on(table.orderLineId),
    index('review_eligibilities_user_product').on(table.userId, table.productId),
    index('review_eligibilities_order_id').on(table.orderId),
    index('review_eligibilities_consumed_at').on(table.consumedAt),
  ],
);

export const ugcServiceSchema = {
  reviews,
  reviewEligibilities,
} as const;

export type UgcServiceSchema = typeof ugcServiceSchema;
