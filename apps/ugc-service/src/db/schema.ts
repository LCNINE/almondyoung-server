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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { TxFor } from '@app/db';
import type {
  BestSelectionStatus,
  ReviewRewardConditions,
  ReviewRewardGrantStatus,
  ReviewRewardKind,
  ReviewRewardLimits,
  ReviewRewardSkipReason,
  ReviewRewardSpec,
  ReviewRewardTrigger,
} from '../reviews/rewards/reward-rule.types';
import type { ReviewPermissionProvider } from '../review-permissions/types';

const timestampColumns = {
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
};

export const reviewRewardPolicyTypeEnum = pgEnum('review_reward_policy_type', ['TEXT', 'PHOTO']);

export const reviewStatusEnum = pgEnum('review_status', ['active', 'hidden']);

export const reviewRewardPolicies = pgTable(
  'review_reward_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewType: reviewRewardPolicyTypeEnum('review_type').notNull(),
    rewardAmount: integer('reward_amount').notNull(),
    active: boolean('active').notNull().default(true),
    minContentLength: integer('min_content_length').notNull().default(10),
    minMediaCount: integer('min_media_count').notNull().default(0),
    description: text('description'),
    priority: integer('priority').notNull().default(0),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('review_reward_policies_type_active_unique')
      .on(table.reviewType)
      .where(sql`${table.active} = true`),
    index('review_reward_policies_active').on(table.active),
  ],
);

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id'),

    productId: uuid('product_id').notNull(),

    rating: integer('rating').notNull(),
    content: text('content').notNull(),

    status: reviewStatusEnum('status').notNull().default('active'),

    sourceSystem: varchar('source_system', { length: 30 }).notNull().default('almondyoung'),

    /**
     * 이 리뷰를 쓸 «권한»으로 소비된 자격 행. 리뷰 모듈은 이 참조가 무슨 종류의 권한인지 모른다 —
     * `provider` 는 권한 행이 들고 있고, 통계는 여기서 조인해 읽는다.
     * 권한 행 없이 들어온 리뷰(이관분·구 데이터)가 있으므로 nullable 이다.
     */
    reviewPermissionId: uuid('review_permission_id').references((): AnyPgColumn => reviewEligibilities.id, {
      onDelete: 'set null',
    }),

    legacyAuthorName: varchar('legacy_author_name', { length: 100 }),
    legacyMemberId: varchar('legacy_member_id', { length: 100 }),
    legacySourceReviewId: integer('legacy_source_review_id'), // article_no
    legacySourceOrderId: varchar('legacy_source_order_id', { length: 50 }),
    legacyImportedAt: timestamp('legacy_imported_at'),
    legacyPayload: jsonb('legacy_payload'),

    deletedAt: timestamp('deleted_at'),

    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('reviews_legacy_source_unique').on(table.sourceSystem, table.legacySourceReviewId),
    index('reviews_product_id').on(table.productId),
    index('reviews_active_product_rating')
      .on(table.productId, table.rating)
      .where(sql`${table.status} = 'active' AND ${table.deletedAt} IS NULL`),
    index('reviews_active_rating')
      .on(table.rating)
      .where(sql`${table.status} = 'active' AND ${table.deletedAt} IS NULL`),
    index('reviews_user_id').on(table.userId),
    index('reviews_created_at').on(table.createdAt),
    /**
     * 「자격 하나로 리뷰 하나」를 DB 로 못 박는다. 앱의 조건부 UPDATE 가 이미 막지만,
     * 다른 경로(스크립트·수동 투입)로도 뚫리지 않게 두는 마지막 관문이다.
     * 권한 행 없이 들어온 이관·구 데이터가 다수라 NULL 은 제외하는 부분 인덱스다.
     */
    uniqueIndex('reviews_review_permission_unique')
      .on(table.reviewPermissionId)
      .where(sql`${table.reviewPermissionId} is not null`),
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

export const questionStatusEnum = pgEnum('question_status', ['active', 'answered']);

export const questionCategoryEnum = pgEnum('question_category', [
  'product',
  'delivery',
  'order',
  'exchange',
  'account',
  'etc',
]);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    nickname: varchar('nickname', { length: 30 }).notNull(),
    productId: uuid('product_id'), // optional: 상품 문의일 때만
    category: questionCategoryEnum('category'), // optional: 1:1 문의일 때 사용
    subCategory: varchar('sub_category', { length: 50 }), // optional: 1:1 문의일 때 사용
    title: varchar('title', { length: 200 }).notNull(),
    content: text('content').notNull(),
    isSecret: boolean('is_secret').notNull().default(false),
    status: questionStatusEnum('status').notNull().default('active'),
    deletedAt: timestamp('deleted_at'),
    ...timestampColumns,
  },
  (table) => [
    index('questions_product_id').on(table.productId),
    index('questions_user_id').on(table.userId),
    index('questions_created_at').on(table.createdAt),
    index('questions_status').on(table.status),
    index('questions_category').on(table.category),
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
    productId: varchar('product_id', { length: 255 }).notNull(),
    orderId: varchar('order_id', { length: 255 }).notNull(),

    /**
     * 이 권한을 «어떻게 얻었는가». pgEnum 이 아니라 varchar 인 것은 발급 경로가 늘어나는 축이라
     * 값을 더할 때마다 `ALTER TYPE` 마이그레이션을 붙이지 않기 위해서다 — 값 검증은 TS 유니온이 한다.
     */
    provider: varchar('provider', { length: 20 }).notNull().default('order').$type<ReviewPermissionProvider>(),

    /** 대량 투입분을 배치 단위로 되돌리기 위한 식별자. 주문 발급분에는 없다. */
    batchId: varchar('batch_id', { length: 64 }),

    /** 「어떤 근거로 줬는가」 — 주문 외 경로의 감사 기록이다. */
    grantedReason: varchar('granted_reason', { length: 255 }),

    /**
     * 주문 라인. 주문에서 나온 권한만 갖는다 — 운영자가 직접 준 권한에는 주문 라인이 없다.
     * 그래서 UNIQUE 도 「라인이 있는 행」에만 걸리는 부분 인덱스다(아래).
     */
    orderLineId: varchar('order_line_id', { length: 255 }),

    /**
     * 주문 라인 결제금액(원). 정률 보상 정책의 모수다.
     * 이 컬럼이 생기기 전 주문과, 금액을 못 넘겨받은 경로는 null 로 남는다 —
     * null 을 0 으로 뭉개면 정률 정책이 조용히 0원을 지급하므로 판정에서 분리한다.
     */
    orderLineAmount: integer('order_line_amount'),

    eligibleAt: timestamp('eligible_at').notNull().defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
    consumedAt: timestamp('consumed_at'),
    consumedByReviewId: uuid('consumed_by_review_id').references(() => reviews.id, {
      onDelete: 'set null',
    }),

    /**
     * 주문 취소로 자격이 무효화된 시각. 만료(`expires_at`)를 앞당기는 방식은
     * `POST /reviews` 가 만료를 보지 않아 구멍이 남으므로 별도 컬럼으로 둔다.
     */
    revokedAt: timestamp('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 40 }),

    sourceSystem: varchar('source_system', { length: 30 }).notNull().default('almondyoung'),
    sourceEventId: varchar('source_event_id', { length: 255 }),

    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('review_eligibilities_source_unique').on(table.sourceSystem, table.sourceEventId),
    uniqueIndex('review_eligibilities_order_line_unique')
      .on(table.orderLineId)
      .where(sql`${table.orderLineId} is not null`),
    index('review_eligibilities_user_product').on(table.userId, table.productId),
    index('review_eligibilities_order_id').on(table.orderId),
    index('review_eligibilities_consumed_at').on(table.consumedAt),
    index('review_eligibilities_expires_at').on(table.expiresAt),
  ],
);

export const reviewRewardTriggerEnum = pgEnum('review_reward_trigger', ['ON_REVIEW_CREATED', 'WEEKLY_BEST']);

export const reviewRewardKindEnum = pgEnum('review_reward_kind', ['NONE', 'POINT_FIXED', 'POINT_RATE', 'BADGE']);

export const reviewRewardGrantStatusEnum = pgEnum('review_reward_grant_status', ['GRANTED', 'SKIPPED', 'REVOKED']);

export const reviewBestSelectionStatusEnum = pgEnum('review_best_selection_status', [
  'CANDIDATE',
  'CONFIRMED',
  'REJECTED',
]);

/**
 * 리뷰 보상 규칙. 활성 규칙이 한 건도 없으면 아무 보상도 나가지 않는다 —
 * active 의 기본값이 false 인 것은 그래서다.
 */
export const reviewRewardRules = pgTable(
  'review_reward_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    trigger: reviewRewardTriggerEnum('trigger').notNull().$type<ReviewRewardTrigger>(),
    active: boolean('active').notNull().default(false),
    /** 큰 값이 먼저 평가된다 */
    priority: integer('priority').notNull().default(0),
    /** 이 규칙이 매칭되면 뒤 규칙을 보지 않는다. false 면 다음 규칙도 계속 평가 */
    stopOnMatch: boolean('stop_on_match').notNull().default(true),
    conditions: jsonb('conditions').$type<ReviewRewardConditions>().notNull(),
    reward: jsonb('reward').$type<ReviewRewardSpec>().notNull(),
    limits: jsonb('limits').$type<ReviewRewardLimits>().notNull(),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
    ...timestampColumns,
  },
  (table) => [
    index('review_reward_rules_trigger_active').on(table.trigger, table.active),
    index('review_reward_rules_priority').on(table.priority),
  ],
);

/**
 * 지급 원장. 지급된 건뿐 아니라 「왜 안 나갔는지」(SKIPPED + skipReason)도 남긴다.
 * 한도 계산·회수·관리자 조회가 전부 이 표를 본다.
 */
export const reviewRewardGrants = pgTable(
  'review_reward_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    ruleId: uuid('rule_id').references(() => reviewRewardRules.id, { onDelete: 'set null' }),
    trigger: reviewRewardTriggerEnum('trigger').notNull().$type<ReviewRewardTrigger>(),
    rewardKind: reviewRewardKindEnum('reward_kind').notNull().$type<ReviewRewardKind>(),
    /** 포인트 금액. 비금전·미지급이면 0 */
    amount: integer('amount').notNull().default(0),
    expiresAt: timestamp('expires_at'),
    status: reviewRewardGrantStatusEnum('status').notNull().$type<ReviewRewardGrantStatus>(),
    skipReason: varchar('skip_reason', { length: 40 }).$type<ReviewRewardSkipReason>(),
    selectionId: uuid('selection_id'),
    revokedAt: timestamp('revoked_at'),
    revokeReason: varchar('revoke_reason', { length: 40 }),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('review_reward_grants_review_trigger_unique').on(table.reviewId, table.trigger),
    index('review_reward_grants_user_created').on(table.userId, table.createdAt),
    index('review_reward_grants_status_created').on(table.status, table.createdAt),
    index('review_reward_grants_rule').on(table.ruleId),
  ],
);

/**
 * 주간 베스트 리뷰 선정. 자동 집계가 후보(CANDIDATE)를 만들고,
 * 관리자가 확정(CONFIRMED)해야 지급·뱃지가 나간다 — 추천수 조작을 사람이 거른다.
 */
export const reviewBestSelections = pgTable(
  'review_best_selections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    periodStart: timestamp('period_start').notNull(),
    periodEnd: timestamp('period_end').notNull(),
    reviewId: uuid('review_id')
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').notNull(),
    ruleId: uuid('rule_id').references(() => reviewRewardRules.id, { onDelete: 'set null' }),
    rank: integer('rank').notNull(),
    helpfulCount: integer('helpful_count').notNull().default(0),
    status: reviewBestSelectionStatusEnum('status').notNull().default('CANDIDATE').$type<BestSelectionStatus>(),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: timestamp('confirmed_at'),
    ...timestampColumns,
  },
  (table) => [
    uniqueIndex('review_best_selections_period_review_unique').on(table.periodStart, table.reviewId),
    index('review_best_selections_period').on(table.periodStart),
    index('review_best_selections_status').on(table.status),
    index('review_best_selections_review').on(table.reviewId),
  ],
);

export const ugcServiceSchema = {
  reviews,
  reviewMedia,
  reviewComments,
  reactions,
  reviewEligibilities,
  reviewRewardPolicies,
  reviewRewardRules,
  reviewRewardGrants,
  reviewBestSelections,
  questions,
  questionMedia,
  answers,
} as const;

export type UgcServiceSchema = typeof ugcServiceSchema;

/**
 * 이 BC 의 트랜잭션 타입. 스키마 옆이 정본이다 — 모듈마다 다시 선언하면 서로를 import 하게 된다.
 */
export type UgcTx = TxFor<UgcServiceSchema>;
