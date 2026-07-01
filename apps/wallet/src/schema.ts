import {
  AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { idempotencyKeys } from './domain/idempotency/idempotency.schema';

// ─── Enums ───────────────────────────────────────────────────────────────────

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'POINTS',
  'CARD',
  'BANK_TRANSFER',
  'BNPL',
  'TOSS',
  'NICEPAY',
  'TOSS_BILLING',
  'NICEPAY_BILLING',
  'CMS_BATCH',
]);

export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'AWAITING_DEPOSIT',
  'AUTHORIZED',
  'CAPTURED',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'PENDING_SETTLEMENT',
  'PARTIALLY_CAPTURED',
]);

export const chargeOperationEnum = pgEnum('charge_operation', ['AUTHORIZE', 'CAPTURE', 'CANCEL', 'REFUND']);

export const chargeStatusEnum = pgEnum('charge_status', [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'REFUNDED',
  'REQUIRES_ACTION',
]);

export const refundStatusEnum = pgEnum('refund_status', ['PENDING', 'SUCCEEDED', 'FAILED']);

export const cashReceiptTypeEnum = pgEnum('cash_receipt_type', ['소득공제', '지출증빙']);
export const cashReceiptStatusEnum = pgEnum('cash_receipt_status', ['ISSUED', 'CANCELED', 'FAILED']);

export const paymentStateEntityTypeEnum = pgEnum('payment_state_entity_type', ['INTENT', 'CHARGE', 'REFUND']);

export const paymentStateTriggerTypeEnum = pgEnum('payment_state_trigger_type', [
  'SYSTEM',
  'USER',
  'ADMIN',
  'WEBHOOK',
  'COMMAND',
]);

export const outboxStatusEnum = pgEnum('wallet_outbox_status', [
  'PENDING',
  'PROCESSING',
  'PUBLISHED',
  'FAILED',
  'DEAD_LETTER',
]);

export const providerWebhookReceiptStatusEnum = pgEnum('provider_webhook_receipt_status', [
  'RECEIVED',
  'PROCESSED',
  'IGNORED_DUPLICATE',
  'FAILED',
]);

export const pointEventTypeEnum = pgEnum('point_event_type', ['EARN', 'REDEEM', 'EARN_CANCEL', 'REDEEM_CANCEL']);

export const pointHoldStatusEnum = pgEnum('point_hold_status', ['AUTHORIZED', 'CAPTURED', 'CANCELLED']);

export const paymentIntentItemTypeEnum = pgEnum('payment_intent_item_type', [
  'PRODUCT',
  'SUBSCRIPTION',
  'SHIPPING_FEE',
  'OTHER',
]);

export const paymentIntentItemDiscountKindEnum = pgEnum('payment_intent_item_discount_kind', [
  'ITEM_PER_UNIT',
  'ITEM_FLAT',
]);

export const paymentIntentOrderDiscountKindEnum = pgEnum('payment_intent_order_discount_kind', ['ORDER']);

export const intentPurposeEnum = pgEnum('intent_purpose', ['PURCHASE', 'SUBSCRIPTION', 'REPAYMENT', 'PAYOUT']);

export const checkoutSessionStatusEnum = pgEnum('checkout_session_status', [
  'PENDING',
  'COMPLETED',
  'EXPIRED',
  'CANCELED',
]);

export const billingMethodStatusEnum = pgEnum('billing_method_status', ['ACTIVE', 'REVOKED', 'DELETED', 'EXPIRED']);

export const billingAgreementStatusEnum = pgEnum('billing_agreement_status', ['ACTIVE', 'SUSPENDED', 'REVOKED']);

export const cmsMemberStatusEnum = pgEnum('cms_member_status', ['PENDING', 'REGISTERED', 'FAILED', 'DELETED']);

export const cmsWithdrawalStatusEnum = pgEnum('cms_withdrawal_status', [
  'REQUESTED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'DELETED',
]);

// ─── Tables ──────────────────────────────────────────────────────────────────

export const paymentMethods = pgTable(
  'payment_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    type: paymentMethodTypeEnum('type').notNull(),
    displayName: varchar('display_name', { length: 255 }),
    isReusable: boolean('is_reusable').notNull().default(true),
    isDeleted: boolean('is_deleted').notNull().default(false),
    providerData: jsonb('provider_data')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_payment_methods_user_id').on(table.userId),
    index('idx_payment_methods_user_type').on(table.userId, table.type),
  ],
);

// ─── Payment method catalog & regions ────────────────────────────────────────
// 사용자별 결제수단(payment_methods)과 별개로, 시스템이 지원하는 결제수단 "종류"의
// 카탈로그와 리전(국가)별 가용성을 관리한다. 최종 노출 = 카탈로그 글로벌 on AND 리전 매핑 on.

export const paymentMethodCatalog = pgTable(
  'payment_method_catalog',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // provider.registry 의 providerType 과 1:1 (예: 'TOSS','NICEPAY','BANK_TRANSFER','POINTS','CMS_BATCH')
    code: varchar('code', { length: 32 }).notNull(),
    displayName: varchar('display_name', { length: 255 }).notNull(),
    description: text('description'),
    // 글로벌 활성화 스위치 (2계층 중 1계층). false 이면 모든 리전에서 숨김.
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('uq_payment_method_catalog_code').on(table.code)],
);

export const regions = pgTable(
  'regions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 소문자 ISO 3166-1 alpha-2 (예: 'kr','us'). Medusa region.countries.iso_2 와 정합.
    code: varchar('code', { length: 2 }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_regions_code').on(table.code),
    check('regions_code_lowercase', sql`${table.code} = lower(${table.code})`),
  ],
);

export const regionPaymentMethods = pgTable(
  'region_payment_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    regionId: uuid('region_id')
      .notNull()
      .references(() => regions.id, { onDelete: 'cascade' }),
    catalogId: uuid('catalog_id')
      .notNull()
      .references(() => paymentMethodCatalog.id, { onDelete: 'cascade' }),
    // 리전별 활성화 스위치 (2계층 중 2계층).
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_region_payment_methods_region_catalog').on(table.regionId, table.catalogId),
    index('idx_region_payment_methods_region').on(table.regionId),
  ],
);

export const paymentIntents = pgTable(
  'payment_intents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    payableAmount: integer('payable_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: paymentIntentStatusEnum('status').notNull(),
    purpose: intentPurposeEnum('purpose').notNull().default('PURCHASE'),
    userId: varchar('user_id', { length: 128 }),
    paymentMethodId: uuid('payment_method_id').references(() => paymentMethods.id),
    clientSecret: varchar('client_secret', { length: 64 }).notNull(),
    returnUrl: text('return_url'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Short-lived deadline for an in-flight REQUIRES_ACTION (e.g. Toss checkout) action.
    // Distinct from the 24h intent `expiresAt`; lets an abandoned action be reclaimed in minutes.
    actionExpiresAt: timestamp('action_expires_at', { withTimezone: true }),
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('payment_intents_payable_amount_non_negative', sql`${table.payableAmount} >= 0`),
    uniqueIndex('uq_payment_intents_client_secret').on(table.clientSecret),
    index('idx_payment_intents_status_expires_at').on(table.status, table.expiresAt),
    index('idx_payment_intents_status_action_expires_at').on(table.status, table.actionExpiresAt),
    index('idx_payment_intents_user_created_at').on(table.userId, table.createdAt),
    uniqueIndex('idx_payment_intents_billing_idempotency_key')
      .on(sql`(${table.metadata}->>'idempotencyKey')`)
      .where(sql`${table.metadata}->>'idempotencyKey' IS NOT NULL`),
  ],
);

export const paymentIntentItems = pgTable(
  'payment_intent_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    lineId: varchar('line_id', { length: 128 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    itemType: paymentIntentItemTypeEnum('item_type'),
    itemRefId: varchar('item_ref_id', { length: 128 }),
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    baseAmount: integer('base_amount').notNull(),
    itemDiscountPerUnitTotal: integer('item_discount_per_unit_total').notNull().default(0),
    itemDiscountFlatTotal: integer('item_discount_flat_total').notNull().default(0),
    payableAmount: integer('payable_amount').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('payment_intent_items_unit_price_non_negative', sql`${table.unitPrice} >= 0`),
    check('payment_intent_items_quantity_positive', sql`${table.quantity} > 0`),
    check('payment_intent_items_base_amount_non_negative', sql`${table.baseAmount} >= 0`),
    check('payment_intent_items_discount_per_unit_non_negative', sql`${table.itemDiscountPerUnitTotal} >= 0`),
    check('payment_intent_items_discount_flat_non_negative', sql`${table.itemDiscountFlatTotal} >= 0`),
    check('payment_intent_items_payable_amount_non_negative', sql`${table.payableAmount} >= 0`),
    uniqueIndex('uq_payment_intent_items_intent_line').on(table.intentId, table.lineId),
    index('idx_payment_intent_items_intent_created_at').on(table.intentId, table.createdAt),
  ],
);

export const paymentIntentItemDiscounts = pgTable(
  'payment_intent_item_discounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => paymentIntentItems.id),
    discountRefId: varchar('discount_ref_id', { length: 128 }),
    kind: paymentIntentItemDiscountKindEnum('kind').notNull(),
    amount: integer('amount').notNull(),
    name: varchar('name', { length: 255 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('payment_intent_item_discounts_amount_positive', sql`${table.amount} > 0`),
    index('idx_payment_intent_item_discounts_intent').on(table.intentId),
    index('idx_payment_intent_item_discounts_item').on(table.itemId),
  ],
);

export const paymentIntentOrderDiscounts = pgTable(
  'payment_intent_order_discounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    discountRefId: varchar('discount_ref_id', { length: 128 }),
    kind: paymentIntentOrderDiscountKindEnum('kind').notNull().default('ORDER'),
    amount: integer('amount').notNull(),
    name: varchar('name', { length: 255 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('payment_intent_order_discounts_amount_positive', sql`${table.amount} > 0`),
    index('idx_payment_intent_order_discounts_intent').on(table.intentId),
  ],
);

export const charges = pgTable(
  'charges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    paymentMethodId: uuid('payment_method_id')
      .notNull()
      .references(() => paymentMethods.id),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    operation: chargeOperationEnum('operation').notNull(),
    status: chargeStatusEnum('status').notNull(),
    providerTransactionId: varchar('provider_transaction_id', { length: 128 }),
    providerIdempotencyKey: varchar('provider_idempotency_key', { length: 255 }).notNull(),
    errorCode: varchar('error_code', { length: 128 }),
    errorMessage: text('error_message'),
    requestPayload: jsonb('request_payload').$type<Record<string, unknown> | null>(),
    responsePayload: jsonb('response_payload').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('charges_amount_positive', sql`${table.amount} > 0`),
    uniqueIndex('uq_charges_provider_idempotency_key').on(table.providerIdempotencyKey),
    uniqueIndex('uq_charges_active_intent_operation')
      .on(table.intentId, table.operation)
      .where(sql`${table.status} in ('CREATED', 'PENDING', 'REQUIRES_ACTION')`),
    index('idx_charges_intent_created_at').on(table.intentId, table.createdAt),
    index('idx_charges_status_created_at').on(table.status, table.createdAt),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charges.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: refundStatusEnum('status').notNull(),
    reasonCode: varchar('reason_code', { length: 128 }),
    reasonMessage: text('reason_message'),
    providerRefundId: varchar('provider_refund_id', { length: 128 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('refunds_amount_positive', sql`${table.amount} > 0`),
    index('idx_refunds_charge_id').on(table.chargeId),
    index('idx_refunds_intent_id').on(table.intentId),
    index('idx_refunds_status_created_at').on(table.status, table.createdAt),
  ],
);

export const cashReceipts = pgTable(
  'cash_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // 현금성(무통장) charge 에 매달린다 — 카드/포인트 charge 는 발급 대상 아님.
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charges.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    userId: varchar('user_id', { length: 128 }),
    type: cashReceiptTypeEnum('type').notNull(),
    // 휴대폰번호(소득공제) 또는 사업자등록번호(지출증빙). 토스 customerIdentityNumber.
    customerIdentityNumber: varchar('customer_identity_number', { length: 30 }).notNull(),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    status: cashReceiptStatusEnum('status').notNull(),
    // 환불 연동: 누적 취소금액. canceledAmount >= amount 면 status='CANCELED'.
    canceledAmount: integer('canceled_amount').notNull().default(0),
    // 토스 응답값
    receiptKey: varchar('receipt_key', { length: 200 }),
    issueNumber: varchar('issue_number', { length: 9 }),
    receiptUrl: text('receipt_url'),
    errorCode: varchar('error_code', { length: 128 }),
    errorMessage: text('error_message'),
    requestPayload: jsonb('request_payload').$type<Record<string, unknown> | null>(),
    responsePayload: jsonb('response_payload').$type<Record<string, unknown> | null>(),
    issuedAt: timestamp('issued_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('cash_receipts_amount_positive', sql`${table.amount} > 0`),
    // charge 당 살아있는(ISSUED) 현금영수증은 하나만 — 이중발급 방지
    uniqueIndex('uq_cash_receipts_active_charge')
      .on(table.chargeId)
      .where(sql`${table.status} = 'ISSUED'`),
    index('idx_cash_receipts_intent').on(table.intentId),
    index('idx_cash_receipts_user_created_at').on(table.userId, table.createdAt),
  ],
);

export const paymentStateTransitions = pgTable(
  'payment_state_transitions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    entityType: paymentStateEntityTypeEnum('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    previousStatus: text('previous_status'),
    newStatus: text('new_status').notNull(),
    reasonCode: varchar('reason_code', { length: 128 }),
    reasonMessage: text('reason_message'),
    triggeredByType: paymentStateTriggerTypeEnum('triggered_by_type').notNull(),
    triggeredById: varchar('triggered_by_id', { length: 128 }),
    correlationId: varchar('correlation_id', { length: 128 }).notNull(),
    causationId: varchar('causation_id', { length: 128 }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown> | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_payment_state_transitions_entity').on(table.entityType, table.entityId, table.occurredAt),
    index('idx_payment_state_transitions_correlation').on(table.correlationId, table.occurredAt),
  ],
);

export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    messageId: varchar('message_id', { length: 64 }).notNull(),
    eventType: varchar('event_type', { length: 128 }).notNull(),
    aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
    aggregateId: uuid('aggregate_id').notNull(),
    partitionKey: varchar('partition_key', { length: 128 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: outboxStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    lastErrorMessage: text('last_error_message'),
    deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
    deadLetterReason: text('dead_letter_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_outbox_events_message_id').on(table.messageId),
    index('idx_outbox_events_status_next_attempt_at').on(table.status, table.nextAttemptAt),
    index('idx_outbox_events_partition_created_at').on(table.partitionKey, table.createdAt),
  ],
);

export const providerWebhookReceipts = pgTable(
  'provider_webhook_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    providerType: varchar('provider_type', { length: 64 }).notNull(),
    providerEventId: varchar('provider_event_id', { length: 128 }).notNull(),
    payloadHash: varchar('payload_hash', { length: 128 }),
    status: providerWebhookReceiptStatusEnum('status').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    lastErrorCode: varchar('last_error_code', { length: 128 }),
    lastErrorMessage: text('last_error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_provider_webhook_receipts_provider_event').on(table.providerType, table.providerEventId),
    index('idx_provider_webhook_receipts_status_received_at').on(table.status, table.receivedAt),
  ],
);

export const pointEvents = pgTable(
  'point_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    eventType: pointEventTypeEnum('event_type').notNull(),
    amount: integer('amount').notNull(),
    originalEventId: uuid('original_event_id'),
    intentId: uuid('intent_id'),
    legId: uuid('leg_id'),
    attemptId: uuid('attempt_id'),
    providerIdempotencyKey: varchar('provider_idempotency_key', { length: 255 }).notNull(),
    providerTransactionId: varchar('provider_transaction_id', { length: 128 }),
    reasonCode: varchar('reason_code', { length: 128 }),
    reasonMessage: text('reason_message'),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('point_events_amount_non_zero', sql`${table.amount} <> 0`),
    check(
      'point_events_type_amount_consistency',
      sql`(
        (${table.eventType} in ('EARN', 'REDEEM_CANCEL') and ${table.amount} > 0)
        or
        (${table.eventType} in ('REDEEM', 'EARN_CANCEL') and ${table.amount} < 0)
      )`,
    ),
    uniqueIndex('uq_point_events_provider_idempotency_key').on(table.providerIdempotencyKey),
    index('idx_point_events_user_created_at').on(table.userId, table.createdAt),
    index('idx_point_events_intent_leg_created_at').on(table.intentId, table.legId, table.createdAt),
    index('idx_point_events_expires_at').on(table.expiresAt),
  ],
);

export const pointEventDetails = pgTable(
  'point_event_details',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    pointEventId: uuid('point_event_id')
      .notNull()
      .references(() => pointEvents.id),
    userId: varchar('user_id', { length: 128 }).notNull(),
    eventType: pointEventTypeEnum('event_type').notNull(),
    amount: integer('amount').notNull(),
    earnedEventDetailId: uuid('earned_event_detail_id').references((): AnyPgColumn => pointEventDetails.id),
    originalEventDetailId: uuid('original_event_detail_id').references((): AnyPgColumn => pointEventDetails.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('point_event_details_amount_non_zero', sql`${table.amount} <> 0`),
    check(
      'point_event_details_type_amount_consistency',
      sql`(
        (${table.eventType} in ('EARN', 'REDEEM_CANCEL') and ${table.amount} > 0)
        or
        (${table.eventType} in ('REDEEM', 'EARN_CANCEL') and ${table.amount} < 0)
      )`,
    ),
    index('idx_point_event_details_user_earned_created_at').on(
      table.userId,
      table.earnedEventDetailId,
      table.createdAt,
    ),
    index('idx_point_event_details_point_event_created_at').on(table.pointEventId, table.createdAt),
  ],
);

export const pointHolds = pgTable(
  'point_holds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    intentId: uuid('intent_id').notNull(),
    legId: uuid('leg_id').notNull(),
    authorizeAttemptId: uuid('authorize_attempt_id').notNull(),
    authorizeProviderIdempotencyKey: varchar('authorize_provider_idempotency_key', {
      length: 255,
    }).notNull(),
    amount: integer('amount').notNull(),
    status: pointHoldStatusEnum('status').notNull(),
    capturedEventId: uuid('captured_event_id').references(() => pointEvents.id),
    captureAttemptId: uuid('capture_attempt_id'),
    captureProviderIdempotencyKey: varchar('capture_provider_idempotency_key', {
      length: 255,
    }),
    cancelAttemptId: uuid('cancel_attempt_id'),
    cancelProviderIdempotencyKey: varchar('cancel_provider_idempotency_key', {
      length: 255,
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('point_holds_amount_positive', sql`${table.amount} > 0`),
    uniqueIndex('uq_point_holds_authorize_provider_idempotency_key').on(table.authorizeProviderIdempotencyKey),
    uniqueIndex('uq_point_holds_capture_provider_idempotency_key')
      .on(table.captureProviderIdempotencyKey)
      .where(sql`${table.captureProviderIdempotencyKey} is not null`),
    uniqueIndex('uq_point_holds_cancel_provider_idempotency_key')
      .on(table.cancelProviderIdempotencyKey)
      .where(sql`${table.cancelProviderIdempotencyKey} is not null`),
    uniqueIndex('uq_point_holds_leg_authorized')
      .on(table.legId)
      .where(sql`${table.status} = 'AUTHORIZED'`),
    index('idx_point_holds_user_status_created_at').on(table.userId, table.status, table.createdAt),
    index('idx_point_holds_leg_created_at').on(table.legId, table.createdAt),
  ],
);

export const pointHoldDetails = pgTable(
  'point_hold_details',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    holdId: uuid('hold_id')
      .notNull()
      .references(() => pointHolds.id),
    earnedEventDetailId: uuid('earned_event_detail_id')
      .notNull()
      .references(() => pointEventDetails.id),
    amount: integer('amount').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check('point_hold_details_amount_positive', sql`${table.amount} > 0`),
    uniqueIndex('uq_point_hold_details_hold_earned_detail').on(table.holdId, table.earnedEventDetailId),
    index('idx_point_hold_details_earned_event_detail_id').on(table.earnedEventDetailId),
  ],
);

// ─── Billing / Checkout / CMS Tables ─────────────────────────────────────────

export const billingMethods = pgTable(
  'billing_methods',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    providerType: varchar('provider_type', { length: 64 }).notNull(),
    billingKey: text('billing_key'),
    customerKey: varchar('customer_key', { length: 128 }),
    cmsMemberId: varchar('cms_member_id', { length: 20 }),
    displayName: varchar('display_name', { length: 255 }),
    method: jsonb('method').$type<Record<string, unknown>>(),
    status: billingMethodStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_billing_methods_user_id').on(table.userId),
    index('idx_billing_methods_user_provider_status').on(table.userId, table.providerType, table.status),
  ],
);

export const billingAgreements = pgTable(
  'billing_agreements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    billingMethodId: uuid('billing_method_id')
      .notNull()
      .references(() => billingMethods.id),
    subscriberRef: varchar('subscriber_ref', { length: 255 }).notNull(),
    subscriberType: varchar('subscriber_type', { length: 64 }).notNull(),
    status: billingAgreementStatusEnum('status').notNull().default('ACTIVE'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_billing_agreements_subscriber').on(table.subscriberType, table.subscriberRef),
    index('idx_billing_agreements_user_id').on(table.userId),
    index('idx_billing_agreements_billing_method_id').on(table.billingMethodId),
  ],
);

export const checkoutSessions = pgTable(
  'checkout_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: varchar('user_id', { length: 128 }).notNull(),
    amount: integer('amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    purpose: intentPurposeEnum('purpose').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    successUrl: text('success_url').notNull(),
    cancelUrl: text('cancel_url').notNull(),
    allowComposite: boolean('allow_composite').notNull().default(false),
    intentId: uuid('intent_id').references(() => paymentIntents.id),
    status: checkoutSessionStatusEnum('status').notNull().default('PENDING'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('idx_checkout_sessions_user_status').on(table.userId, table.status),
    index('idx_checkout_sessions_status_expires_at').on(table.status, table.expiresAt),
  ],
);

export const cmsMembers = pgTable(
  'cms_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    billingMethodId: uuid('billing_method_id')
      .notNull()
      .references(() => billingMethods.id),
    userId: varchar('user_id', { length: 128 }).notNull(),
    cmsMemberId: varchar('cms_member_id', { length: 20 }).notNull(),
    paymentCompany: varchar('payment_company', { length: 3 }).notNull(),
    payerName: varchar('payer_name', { length: 15 }).notNull(),
    payerNumber: varchar('payer_number', { length: 10 }).notNull(),
    status: cmsMemberStatusEnum('status').notNull().default('PENDING'),
    resultCode: varchar('result_code', { length: 16 }),
    resultMessage: text('result_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_cms_members_cms_member_id').on(table.cmsMemberId),
    index('idx_cms_members_billing_method_id').on(table.billingMethodId),
    index('idx_cms_members_user_id').on(table.userId),
    index('idx_cms_members_status').on(table.status),
  ],
);

export const cmsWithdrawals = pgTable(
  'cms_withdrawals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cmsMemberId: varchar('cms_member_id', { length: 20 }).notNull(),
    transactionId: varchar('transaction_id', { length: 30 }).notNull(),
    chargeId: uuid('charge_id')
      .notNull()
      .references(() => charges.id),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => paymentIntents.id),
    paymentDate: varchar('payment_date', { length: 8 }).notNull(),
    amount: integer('amount').notNull(),
    status: cmsWithdrawalStatusEnum('status').notNull().default('REQUESTED'),
    resultCode: varchar('result_code', { length: 16 }),
    resultMessage: text('result_message'),
    actualAmount: integer('actual_amount'),
    fee: integer('fee'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('uq_cms_withdrawals_transaction_id').on(table.transactionId),
    index('idx_cms_withdrawals_intent_id').on(table.intentId),
    index('idx_cms_withdrawals_status_payment_date').on(table.status, table.paymentDate),
  ],
);

export const cmsAgreements = pgTable(
  'cms_agreements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cmsMemberId: varchar('cms_member_id', { length: 20 }).notNull(),
    agreementKey: varchar('agreement_key', { length: 64 }),
    fileType: varchar('file_type', { length: 16 }).notNull(),
    fileExtension: varchar('file_extension', { length: 8 }).notNull(),
    status: varchar('status', { length: 32 }).notNull(),
    resultCode: varchar('result_code', { length: 16 }),
    resultMessage: text('result_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('idx_cms_agreements_cms_member_id').on(table.cmsMemberId)],
);

// ─── Type exports ─────────────────────────────────────────────────────────────

export type PaymentMethodType = (typeof paymentMethodTypeEnum.enumValues)[number];
export type PaymentIntentStatus = (typeof paymentIntentStatusEnum.enumValues)[number];
export type ChargeOperation = (typeof chargeOperationEnum.enumValues)[number];
export type ChargeStatus = (typeof chargeStatusEnum.enumValues)[number];
export type RefundStatus = (typeof refundStatusEnum.enumValues)[number];
export type CashReceiptType = (typeof cashReceiptTypeEnum.enumValues)[number];
export type CashReceiptStatus = (typeof cashReceiptStatusEnum.enumValues)[number];
export type PaymentStateEntityType = (typeof paymentStateEntityTypeEnum.enumValues)[number];
export type PaymentStateTriggerType = (typeof paymentStateTriggerTypeEnum.enumValues)[number];
export type OutboxStatus = (typeof outboxStatusEnum.enumValues)[number];
export type PointEventType = (typeof pointEventTypeEnum.enumValues)[number];
export type PointHoldStatus = (typeof pointHoldStatusEnum.enumValues)[number];
export type PaymentIntentItemType = (typeof paymentIntentItemTypeEnum.enumValues)[number];
export type PaymentIntentItemDiscountKind = (typeof paymentIntentItemDiscountKindEnum.enumValues)[number];
export type PaymentIntentOrderDiscountKind = (typeof paymentIntentOrderDiscountKindEnum.enumValues)[number];
export type IntentPurpose = (typeof intentPurposeEnum.enumValues)[number];
export type CheckoutSessionStatus = (typeof checkoutSessionStatusEnum.enumValues)[number];
export type BillingMethodStatus = (typeof billingMethodStatusEnum.enumValues)[number];
export type BillingAgreementStatus = (typeof billingAgreementStatusEnum.enumValues)[number];
export type CmsMemberStatus = (typeof cmsMemberStatusEnum.enumValues)[number];
export type CmsWithdrawalStatus = (typeof cmsWithdrawalStatusEnum.enumValues)[number];

// ─── Schema object ────────────────────────────────────────────────────────────

export const walletSchema = {
  paymentMethods,
  paymentMethodCatalog,
  regions,
  regionPaymentMethods,
  paymentIntents,
  paymentIntentItems,
  paymentIntentItemDiscounts,
  paymentIntentOrderDiscounts,
  charges,
  refunds,
  cashReceipts,
  paymentStateTransitions,
  outboxEvents,
  providerWebhookReceipts,
  pointEvents,
  pointEventDetails,
  pointHolds,
  pointHoldDetails,
  idempotencyKeys,
  billingMethods,
  billingAgreements,
  checkoutSessions,
  cmsMembers,
  cmsWithdrawals,
  cmsAgreements,
};

export { idempotencyKeys };

export type WalletSchema = typeof walletSchema;
