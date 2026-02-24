import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const client = postgres(process.env.DATABASE_URL ?? '');
export const db = drizzle(client);

// ─── Enums (read-only 조회용) ─────────────────────────────────────────────────

export const paymentMethodTypeEnum = pgEnum('payment_method_type', [
  'POINTS',
  'CARD',
  'BANK_TRANSFER',
  'BNPL',
  'TOSS',
]);

export const paymentIntentStatusEnum = pgEnum('payment_intent_status', [
  'CREATED',
  'PROCESSING',
  'REQUIRES_ACTION',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
]);

export const chargeOperationEnum = pgEnum('charge_operation', [
  'AUTHORIZE',
  'CAPTURE',
  'CANCEL',
  'REFUND',
]);

export const chargeStatusEnum = pgEnum('charge_status', [
  'CREATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELED',
  'REFUNDED',
  'REQUIRES_ACTION',
]);

export const refundStatusEnum = pgEnum('refund_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
]);

export const paymentStateEntityTypeEnum = pgEnum('payment_state_entity_type', [
  'INTENT',
  'CHARGE',
  'REFUND',
]);

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

export const pointEventTypeEnum = pgEnum('point_event_type', [
  'EARN',
  'REDEEM',
  'EARN_CANCEL',
  'REDEEM_CANCEL',
]);

export const pointHoldStatusEnum = pgEnum('point_hold_status', [
  'AUTHORIZED',
  'CAPTURED',
  'CANCELLED',
]);

// ─── Tables (조회 전용 — 제약 생략) ───────────────────────────────────────────

export const paymentMethods = pgTable('payment_methods', {
  id: uuid('id').primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  type: paymentMethodTypeEnum('type').notNull(),
  displayName: varchar('display_name', { length: 255 }),
  isReusable: boolean('is_reusable').notNull(),
  isDeleted: boolean('is_deleted').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const paymentIntents = pgTable('payment_intents', {
  id: uuid('id').primaryKey(),
  payableAmount: integer('payable_amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: paymentIntentStatusEnum('status').notNull(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  paymentMethodId: uuid('payment_method_id'),
  clientSecret: varchar('client_secret', { length: 64 }).notNull(),
  returnUrl: text('return_url'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  version: integer('version').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const paymentIntentItems = pgTable('payment_intent_items', {
  id: uuid('id').primaryKey(),
  intentId: uuid('intent_id').notNull(),
  lineId: varchar('line_id', { length: 128 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  itemType: varchar('item_type', { length: 64 }),
  itemRefId: varchar('item_ref_id', { length: 128 }),
  unitPrice: integer('unit_price').notNull(),
  quantity: integer('quantity').notNull(),
  baseAmount: integer('base_amount').notNull(),
  itemDiscountPerUnitTotal: integer('item_discount_per_unit_total').notNull(),
  itemDiscountFlatTotal: integer('item_discount_flat_total').notNull(),
  payableAmount: integer('payable_amount').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const charges = pgTable('charges', {
  id: uuid('id').primaryKey(),
  intentId: uuid('intent_id').notNull(),
  paymentMethodId: uuid('payment_method_id').notNull(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey(),
  chargeId: uuid('charge_id').notNull(),
  intentId: uuid('intent_id').notNull(),
  amount: integer('amount').notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: refundStatusEnum('status').notNull(),
  reasonCode: varchar('reason_code', { length: 128 }),
  reasonMessage: text('reason_message'),
  providerRefundId: varchar('provider_refund_id', { length: 128 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const paymentStateTransitions = pgTable('payment_state_transitions', {
  id: uuid('id').primaryKey(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  messageId: varchar('message_id', { length: 64 }).notNull(),
  eventType: varchar('event_type', { length: 128 }).notNull(),
  aggregateType: varchar('aggregate_type', { length: 64 }).notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  partitionKey: varchar('partition_key', { length: 128 }).notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>(),
  status: outboxStatusEnum('status').notNull(),
  attempts: integer('attempts').notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 128 }),
  lastErrorMessage: text('last_error_message'),
  deadLetteredAt: timestamp('dead_lettered_at', { withTimezone: true }),
  deadLetterReason: text('dead_letter_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const pointEvents = pgTable('point_events', {
  id: uuid('id').primaryKey(),
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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const pointHolds = pgTable('point_holds', {
  id: uuid('id').primaryKey(),
  userId: varchar('user_id', { length: 128 }).notNull(),
  intentId: uuid('intent_id').notNull(),
  legId: uuid('leg_id').notNull(),
  authorizeAttemptId: uuid('authorize_attempt_id').notNull(),
  amount: integer('amount').notNull(),
  status: pointHoldStatusEnum('status').notNull(),
  capturedEventId: uuid('captured_event_id'),
  captureAttemptId: uuid('capture_attempt_id'),
  cancelAttemptId: uuid('cancel_attempt_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type PaymentIntent = typeof paymentIntents.$inferSelect;
export type PaymentMethod = typeof paymentMethods.$inferSelect;
export type Charge = typeof charges.$inferSelect;
export type Refund = typeof refunds.$inferSelect;
export type PaymentStateTransition = typeof paymentStateTransitions.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;
export type PointEvent = typeof pointEvents.$inferSelect;
export type PointHold = typeof pointHolds.$inferSelect;
export type PaymentIntentItem = typeof paymentIntentItems.$inferSelect;
