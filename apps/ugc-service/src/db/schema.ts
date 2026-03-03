import {
  integer,
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  boolean,
  varchar,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

const timestampColumns = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
};

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

export const reviewMedia = pgTable(
  'review_media',
  {
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull(),
    order: integer('order').notNull(),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('review_media_review_order_unique').on(table.reviewId, table.order),
    primaryKey({ columns: [table.reviewId, table.fileId], name: 'review_media_pkey' }),
    index('review_media_review_id').on(table.reviewId),
    index('review_media_file_id').on(table.fileId),
  ],
);

export const reactions = pgTable(
  'reactions',
  {
    targetType: varchar('target_type', { length: 20 }).notNull(), // 'review', 'question', 'answer'
    targetId: uuid('target_id').notNull(),
    userId: uuid('user_id').notNull(),
    reactionType: varchar('reaction_type', { length: 20 }).notNull(), // 'helpful', 'like', 'dislike'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.targetType, table.targetId, table.userId, table.reactionType],
      name: 'reactions_pkey',
    }),
    index('reactions_target').on(table.targetType, table.targetId),
    index('reactions_user').on(table.userId),
  ],
);

export const reviewComments = pgTable(
  'review_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    adminUserId: uuid('admin_user_id').notNull(),
    content: text('content').notNull(),
    ...timestampColumns,
  },
  (table) => [uniqueIndex('review_comments_review_id_unique').on(table.reviewId)],
);

export const questionStatusEnum = pgEnum('question_status', ['active', 'answered', 'deleted']);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    nickname: varchar('nickname', { length: 30 }).notNull(),
    productId: uuid('product_id').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
    status: questionStatusEnum('status').notNull().default('active'),
    ...timestampColumns,
  },
  (table) => [
    index('questions_product_id').on(table.productId),
    index('questions_user_id').on(table.userId),
    index('questions_created_at').on(table.createdAt),
    index('questions_status').on(table.status),
  ],
);

export const questionMedia = pgTable(
  'question_media',
  {
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').notNull(),
    order: integer('order').notNull(),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('question_media_question_order_unique').on(table.questionId, table.order),
    primaryKey({ columns: [table.questionId, table.fileId], name: 'question_media_pkey' }),
    index('question_media_question_id').on(table.questionId),
  ],
);

export const answers = pgTable(
  'answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    adminUserId: uuid('admin_user_id').notNull(),
    content: text('content').notNull(),
    ...timestampColumns,
  },
  (table) => [uniqueIndex('answers_question_id_unique').on(table.questionId)],
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
    uniqueIndex('review_eligibilities_source_unique').on(table.sourceSystem, table.sourceEventId),
    uniqueIndex('review_eligibilities_order_line_unique').on(table.orderLineId),
    index('review_eligibilities_user_product').on(table.userId, table.productId),
    index('review_eligibilities_order_id').on(table.orderId),
    index('review_eligibilities_consumed_at').on(table.consumedAt),
  ],
);

export const ugcServiceSchema = {
  reviews,
  reviewMedia,
  reviewComments,
  reactions,
  reviewEligibilities,
  questions,
  questionMedia,
  answers,
} as const;

export type UgcServiceSchema = typeof ugcServiceSchema;
