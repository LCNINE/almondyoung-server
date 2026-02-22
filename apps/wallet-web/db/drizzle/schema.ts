import { sql } from "drizzle-orm";
import {
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
} from "drizzle-orm/pg-core";

export const manualCancelActionType = pgEnum("manual_cancel_action_type", [
  "CANCEL",
  "REFUND",
  "MANUAL_CONFIRM",
]);

export const manualCancelQueueStatus = pgEnum("manual_cancel_queue_status", [
  "QUEUED",
  "ASSIGNED",
  "PROCESSING",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "CLOSED",
]);

export const paymentAttemptOperation = pgEnum("payment_attempt_operation", [
  "AUTHORIZE",
  "CAPTURE",
  "CANCEL",
  "REFUND",
  "MANUAL_CONFIRM",
]);

export const paymentAttemptStatus = pgEnum("payment_attempt_status", [
  "CREATED",
  "SENT",
  "PENDING_PROVIDER",
  "REQUIRES_ACTION",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED_RETRYABLE",
  "FAILED_FINAL",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "REFUND_REQUESTED",
  "REFUNDED",
  "UNKNOWN",
  "RECONCILE_REQUIRED",
]);

export const paymentIntentStatus = pgEnum("payment_intent_status", [
  "PENDING",
  "IN_PROGRESS",
  "PARTIALLY_CAPTURED",
  "SUCCEEDED",
  "FAILED",
  "EXPIRED",
  "CANCELLED",
  "SUSPENDED",
  "SUPERSEDED",
  "RECONCILING",
  "SUPERSEDED_RECONCILE_REQUIRED",
  "RECONCILE_REQUIRED",
]);

export const paymentLegStatus = pgEnum("payment_leg_status", [
  "PLANNED",
  "READY",
  "PROCESSING",
  "REQUIRES_CUSTOMER_ACTION",
  "REQUIRES_ADMIN_CONFIRMATION",
  "AUTHORIZED",
  "CAPTURED",
  "FAILED",
  "EXPIRED",
  "CANCELING",
  "CANCELLED",
  "REFUNDING",
  "REFUNDED",
  "RECONCILE_REQUIRED",
]);

export const paymentReferenceType = pgEnum("payment_reference_type", [
  "STORE_ORDER",
  "SUBSCRIPTION_BILLING",
]);

export const paymentStateEntityType = pgEnum("payment_state_entity_type", [
  "INTENT",
  "LEG",
  "ATTEMPT",
  "REFUND_REQUEST",
  "MANUAL_CANCEL_QUEUE_ITEM",
]);

export const paymentStateTriggerType = pgEnum("payment_state_trigger_type", [
  "SYSTEM",
  "USER",
  "ADMIN",
  "WEBHOOK",
  "COMMAND",
]);

export const providerWebhookReceiptStatus = pgEnum(
  "provider_webhook_receipt_status",
  ["RECEIVED", "PROCESSED", "IGNORED_DUPLICATE", "FAILED"]
);

export const refundRequestStatus = pgEnum("refund_request_status", [
  "REQUESTED",
  "VALIDATED",
  "PROCESSING",
  "PARTIALLY_COMPLETED",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "RECONCILE_REQUIRED",
]);

export const walletOutboxStatus = pgEnum("wallet_outbox_status", [
  "PENDING",
  "PROCESSING",
  "PUBLISHED",
  "FAILED",
  "DEAD_LETTER",
]);

export const paymentIntentItemType = pgEnum("payment_intent_item_type", [
  "PRODUCT",
  "SHIPPING_FEE",
]);

export const paymentIntentItemDiscountKind = pgEnum(
  "payment_intent_item_discount_kind",
  ["ITEM_PER_UNIT", "ITEM_FLAT"]
);

export const paymentIntentOrderDiscountKind = pgEnum(
  "payment_intent_order_discount_kind",
  ["ORDER"]
);

export const paymentIntents = pgTable(
  "payment_intents",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    referenceType: paymentReferenceType("reference_type").notNull(),
    referenceId: varchar("reference_id", { length: 128 }).notNull(),
    userId: varchar("user_id", { length: 128 }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    payableAmount: integer("payable_amount").notNull(),
    status: paymentIntentStatus("status").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    version: integer("version").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "payment_intents_payable_amount_non_negative",
      sql`${table.payableAmount} >= 0`
    ),
    index("idx_payment_intents_reference").on(
      table.referenceType,
      table.referenceId
    ),
    index("idx_payment_intents_user_created_at").on(table.userId, table.createdAt),
    index("idx_payment_intents_status_expires_at").on(
      table.status,
      table.expiresAt
    ),
    uniqueIndex("uq_payment_intents_reference_blocking")
      .on(table.referenceType, table.referenceId)
      .where(
        sql`${table.status} in ('PENDING', 'IN_PROGRESS', 'PARTIALLY_CAPTURED', 'RECONCILING')`
      ),
  ]
);

export const paymentLegs = pgTable(
  "payment_legs",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    providerType: varchar("provider_type", { length: 64 }).notNull(),
    amount: integer("amount").notNull(),
    status: paymentLegStatus("status").notNull(),
    isRequired: boolean("is_required").notNull().default(true),
    sequenceNo: integer("sequence_no").notNull(),
    version: integer("version").notNull().default(0),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("payment_legs_amount_positive", sql`${table.amount} > 0`),
    uniqueIndex("uq_payment_legs_intent_sequence").on(
      table.intentId,
      table.sequenceNo
    ),
    index("idx_payment_legs_intent_status").on(table.intentId, table.status),
    index("idx_payment_legs_provider_status").on(
      table.providerType,
      table.status
    ),
  ]
);

export const paymentIntentItems = pgTable(
  "payment_intent_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    lineId: varchar("line_id", { length: 128 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    itemType: paymentIntentItemType("item_type"),
    itemRefId: varchar("item_ref_id", { length: 128 }),
    unitPrice: integer("unit_price").notNull(),
    quantity: integer("quantity").notNull(),
    baseAmount: integer("base_amount").notNull(),
    itemDiscountPerUnitTotal: integer("item_discount_per_unit_total")
      .notNull()
      .default(0),
    itemDiscountFlatTotal: integer("item_discount_flat_total")
      .notNull()
      .default(0),
    payableAmount: integer("payable_amount").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("payment_intent_items_unit_price_non_negative", sql`${table.unitPrice} >= 0`),
    check("payment_intent_items_quantity_positive", sql`${table.quantity} > 0`),
    check("payment_intent_items_base_amount_non_negative", sql`${table.baseAmount} >= 0`),
    check(
      "payment_intent_items_discount_per_unit_non_negative",
      sql`${table.itemDiscountPerUnitTotal} >= 0`
    ),
    check(
      "payment_intent_items_discount_flat_non_negative",
      sql`${table.itemDiscountFlatTotal} >= 0`
    ),
    check(
      "payment_intent_items_payable_amount_non_negative",
      sql`${table.payableAmount} >= 0`
    ),
    check(
      "payment_intent_items_item_type_and_ref_consistency",
      sql`${table.itemType} is not null or ${table.itemRefId} is null`
    ),
    check(
      "payment_intent_items_shipping_fee_ref_must_be_null",
      sql`${table.itemType} <> 'SHIPPING_FEE' or ${table.itemRefId} is null`
    ),
    uniqueIndex("uq_payment_intent_items_intent_line").on(
      table.intentId,
      table.lineId
    ),
    index("idx_payment_intent_items_intent_created_at").on(
      table.intentId,
      table.createdAt
    ),
  ]
);

export const paymentIntentItemDiscounts = pgTable(
  "payment_intent_item_discounts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    itemId: uuid("item_id")
      .notNull()
      .references(() => paymentIntentItems.id),
    discountId: varchar("discount_id", { length: 128 }),
    kind: paymentIntentItemDiscountKind("kind").notNull(),
    amount: integer("amount").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("payment_intent_item_discounts_amount_positive", sql`${table.amount} > 0`),
    index("idx_payment_intent_item_discounts_intent_created_at").on(
      table.intentId,
      table.createdAt
    ),
    index("idx_payment_intent_item_discounts_item_created_at").on(
      table.itemId,
      table.createdAt
    ),
  ]
);

export const paymentIntentOrderDiscounts = pgTable(
  "payment_intent_order_discounts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    discountId: varchar("discount_id", { length: 128 }),
    kind: paymentIntentOrderDiscountKind("kind").notNull(),
    amount: integer("amount").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "payment_intent_order_discounts_kind_order_only",
      sql`${table.kind} = 'ORDER'`
    ),
    check("payment_intent_order_discounts_amount_positive", sql`${table.amount} > 0`),
    index("idx_payment_intent_order_discounts_intent_created_at").on(
      table.intentId,
      table.createdAt
    ),
  ]
);

export const paymentAttempts = pgTable(
  "payment_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    legId: uuid("leg_id")
      .notNull()
      .references(() => paymentLegs.id),
    attemptNo: integer("attempt_no").notNull(),
    operation: paymentAttemptOperation("operation").notNull(),
    status: paymentAttemptStatus("status").notNull(),
    providerTransactionId: varchar("provider_transaction_id", { length: 128 }),
    providerRequestId: varchar("provider_request_id", { length: 128 }),
    idempotencyKey: varchar("idempotency_key", { length: 128 }),
    providerIdempotencyKey: varchar("provider_idempotency_key", {
      length: 255,
    }).notNull(),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    requestPayload: jsonb("request_payload"),
    responsePayload: jsonb("response_payload"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_payment_attempts_leg_attempt_no").on(table.legId, table.attemptNo),
    uniqueIndex("uq_payment_attempts_provider_transaction_id").on(
      table.providerTransactionId
    ),
    uniqueIndex("uq_payment_attempts_provider_idempotency_key").on(
      table.providerIdempotencyKey
    ),
    uniqueIndex("uq_payment_attempts_active_leg_operation")
      .on(table.legId, table.operation)
      .where(
        sql`${table.status} in ('CREATED', 'SENT', 'PENDING_PROVIDER', 'REQUIRES_ACTION', 'CANCEL_REQUESTED', 'REFUND_REQUESTED')`
      ),
    index("idx_payment_attempts_leg_created_at").on(table.legId, table.createdAt),
    index("idx_payment_attempts_intent_created_at").on(
      table.intentId,
      table.createdAt
    ),
    index("idx_payment_attempts_status_created_at").on(
      table.status,
      table.createdAt
    ),
  ]
);

export const refundRequests = pgTable(
  "refund_requests",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    referenceType: paymentReferenceType("reference_type").notNull(),
    referenceId: varchar("reference_id", { length: 128 }).notNull(),
    status: refundRequestStatus("status").notNull(),
    refundAmount: integer("refund_amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    reasonCode: varchar("reason_code", { length: 128 }).notNull(),
    reasonMessage: text("reason_message"),
    requestedBy: varchar("requested_by", { length: 128 }).notNull(),
    approvedBy: varchar("approved_by", { length: 128 }),
    rejectedBy: varchar("rejected_by", { length: 128 }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("refund_requests_refund_amount_positive", sql`${table.refundAmount} > 0`),
    index("idx_refund_requests_intent_created_at").on(table.intentId, table.createdAt),
    index("idx_refund_requests_status_created_at").on(table.status, table.createdAt),
  ]
);

export const refundAllocations = pgTable(
  "refund_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    refundRequestId: uuid("refund_request_id")
      .notNull()
      .references(() => refundRequests.id),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    legId: uuid("leg_id")
      .notNull()
      .references(() => paymentLegs.id),
    amount: integer("amount").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("refund_allocations_amount_positive", sql`${table.amount} > 0`),
    uniqueIndex("uq_refund_allocations_refund_request_leg").on(
      table.refundRequestId,
      table.legId
    ),
  ]
);

export const manualCancelQueueItems = pgTable(
  "manual_cancel_queue_items",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => paymentIntents.id),
    legId: uuid("leg_id")
      .notNull()
      .references(() => paymentLegs.id),
    actionType: manualCancelActionType("action_type").notNull(),
    status: manualCancelQueueStatus("status").notNull(),
    reasonCode: varchar("reason_code", { length: 128 }).notNull(),
    reasonMessage: text("reason_message"),
    assignedTo: varchar("assigned_to", { length: 128 }),
    priority: varchar("priority", { length: 20 }).notNull().default("normal"),
    retryCount: integer("retry_count").notNull().default(0),
    lastErrorCode: varchar("last_error_code", { length: 128 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_manual_cancel_queue_status_priority_created_at").on(
      table.status,
      table.priority,
      table.createdAt
    ),
    index("idx_manual_cancel_queue_assigned_to_status").on(
      table.assignedTo,
      table.status
    ),
    index("idx_manual_cancel_queue_intent_status").on(table.intentId, table.status),
    uniqueIndex("uq_manual_cancel_queue_open_intent_leg")
      .on(table.intentId, table.legId)
      .where(
        sql`${table.status} in ('QUEUED', 'ASSIGNED', 'PROCESSING', 'FAILED_RETRYABLE')`
      ),
  ]
);

export const paymentStateTransitions = pgTable(
  "payment_state_transitions",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    entityType: paymentStateEntityType("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    previousStatus: text("previous_status"),
    newStatus: text("new_status").notNull(),
    reasonCode: varchar("reason_code", { length: 128 }),
    reasonMessage: text("reason_message"),
    triggeredByType: paymentStateTriggerType("triggered_by_type").notNull(),
    triggeredById: varchar("triggered_by_id", { length: 128 }),
    correlationId: varchar("correlation_id", { length: 128 }).notNull(),
    causationId: varchar("causation_id", { length: 128 }),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_payment_state_transitions_entity_occurred_at").on(
      table.entityType,
      table.entityId,
      table.occurredAt
    ),
    index("idx_payment_state_transitions_correlation_occurred_at").on(
      table.correlationId,
      table.occurredAt
    ),
  ]
);

export const outboxEvents = pgTable(
  "outbox_events",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    messageId: varchar("message_id", { length: 64 }).notNull(),
    eventType: varchar("event_type", { length: 128 }).notNull(),
    aggregateType: varchar("aggregate_type", { length: 64 }).notNull(),
    aggregateId: uuid("aggregate_id").notNull(),
    partitionKey: varchar("partition_key", { length: 128 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: walletOutboxStatus("status").notNull().default("PENDING"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      mode: "string",
    }),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastErrorCode: varchar("last_error_code", { length: 128 }),
    lastErrorMessage: text("last_error_message"),
    deadLetteredAt: timestamp("dead_lettered_at", {
      withTimezone: true,
      mode: "string",
    }),
    deadLetterReason: text("dead_letter_reason"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_outbox_events_message_id").on(table.messageId),
    index("idx_outbox_events_status_next_attempt_at").on(
      table.status,
      table.nextAttemptAt
    ),
    index("idx_outbox_events_partition_created_at").on(
      table.partitionKey,
      table.createdAt
    ),
  ]
);

export const providerWebhookReceipts = pgTable(
  "provider_webhook_receipts",
  {
    id: uuid("id").defaultRandom().primaryKey().notNull(),
    providerType: varchar("provider_type", { length: 64 }).notNull(),
    providerEventId: varchar("provider_event_id", { length: 128 }).notNull(),
    payloadHash: varchar("payload_hash", { length: 128 }),
    status: providerWebhookReceiptStatus("status").notNull(),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      mode: "string",
    }),
    lastErrorCode: varchar("last_error_code", { length: 128 }),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
    })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_provider_webhook_receipts_provider_event").on(
      table.providerType,
      table.providerEventId
    ),
    index("idx_provider_webhook_receipts_provider_received_at").on(
      table.providerType,
      table.receivedAt
    ),
    index("idx_provider_webhook_receipts_status_received_at").on(
      table.status,
      table.receivedAt
    ),
  ]
);
