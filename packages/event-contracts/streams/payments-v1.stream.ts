import { event, stream } from '../types';
import { z } from 'zod';

export type PaymentsV1ReferenceType = 'STORE_ORDER' | 'SUBSCRIPTION_BILLING';

export interface PaymentIntentEventBasePayload {
  intentId: string;
  referenceType: PaymentsV1ReferenceType;
  referenceId: string;
  userId: string;
  status: string;
  payableAmount: number;
  currency: string;
  occurredAt: string;
}

export interface PaymentIntentSucceededPayload extends PaymentIntentEventBasePayload {}
export interface PaymentIntentFailedPayload extends PaymentIntentEventBasePayload {
  reasonCode?: string;
  reasonMessage?: string;
}
export interface PaymentIntentExpiredPayload extends PaymentIntentEventBasePayload {
  reasonCode?: string;
  reasonMessage?: string;
}
export interface PaymentIntentCancelledPayload extends PaymentIntentEventBasePayload {
  reasonCode?: string;
  reasonMessage?: string;
}
export interface PaymentIntentSupersededPayload extends PaymentIntentEventBasePayload {
  reasonCode?: string;
  reasonMessage?: string;
}

export interface PaymentReconcileRequiredPayload
  extends PaymentIntentEventBasePayload {
  reasonCode: string;
  reasonMessage: string;
  requiresManualAction: boolean;
  manualQueueItemId?: string | null;
  manualQueueItemIds?: string[];
}

export interface RefundAllocationItemPayload {
  legId: string;
  amount: number;
}

export interface RefundRequestedV1Payload {
  refundId: string;
  intentId: string;
  referenceType: PaymentsV1ReferenceType;
  referenceId: string;
  userId: string;
  refundAmount: number;
  currency: string;
  allocation: RefundAllocationItemPayload[];
  occurredAt: string;
}

export interface RefundCompletedV1Payload {
  refundId: string;
  intentId: string;
  referenceType: PaymentsV1ReferenceType;
  referenceId: string;
  userId: string;
  refundAmount: number;
  currency: string;
  allocation: RefundAllocationItemPayload[];
  occurredAt: string;
}

export interface RefundFailedV1Payload {
  refundId: string;
  intentId: string;
  referenceType: PaymentsV1ReferenceType;
  referenceId: string;
  userId: string;
  refundAmount: number;
  currency: string;
  allocation: RefundAllocationItemPayload[];
  reasonCode: string;
  reasonMessage: string;
  requiresManualAction: boolean;
  manualQueueItemId?: string | null;
  manualQueueItemIds?: string[];
  occurredAt: string;
}

interface CommandCommonPayload {
  requestedBy: string;
  requestSource: string;
  idempotencyKey: string;
}

export interface CreatePaymentIntentCommandPayload extends CommandCommonPayload {
  referenceType: PaymentsV1ReferenceType;
  referenceId: string;
  userId: string;
  currency: string;
  payableAmount: number;
  snapshotPayload: Record<string, unknown>;
  signature: string;
  signatureVersion: string;
  signedAt: string;
  metadata?: Record<string, unknown>;
  billingContext?: Record<string, unknown>;
}

export interface StartPaymentLegCommandPayload extends CommandCommonPayload {
  intentId: string;
  legId: string;
  providerType: string;
  amount: number;
  operation?: 'AUTHORIZE' | 'CAPTURE';
}

export interface CancelPaymentIntentCommandPayload extends CommandCommonPayload {
  intentId: string;
}

export interface ExpirePaymentIntentCommandPayload extends CommandCommonPayload {
  intentId: string;
}

export interface SupersedePaymentIntentCommandPayload
  extends CommandCommonPayload {
  intentId: string;
}

export interface RequestRefundCommandPayload extends CommandCommonPayload {
  intentId: string;
  refundAmount: number;
  allocation: RefundAllocationItemPayload[];
  reasonCode: string;
  reasonMessage?: string;
}

export interface RetryReconcileCommandPayload extends CommandCommonPayload {
  intentId?: string;
  legId?: string;
  reasonCode: string;
  reasonMessage?: string;
  force?: boolean;
}

const PaymentReferenceTypeSchema = z.enum([
  'STORE_ORDER',
  'SUBSCRIPTION_BILLING',
]);

const PaymentIntentEventBaseSchema = z.object({
  intentId: z.string().min(1),
  referenceType: PaymentReferenceTypeSchema,
  referenceId: z.string().min(1),
  userId: z.string().min(1),
  status: z.string().min(1),
  payableAmount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  occurredAt: z.string().datetime(),
});

const PaymentIntentSucceededSchema = PaymentIntentEventBaseSchema;

const PaymentIntentFailedSchema = PaymentIntentEventBaseSchema.extend({
  reasonCode: z.string().min(1).optional(),
  reasonMessage: z.string().min(1).optional(),
});

const PaymentIntentExpiredSchema = PaymentIntentEventBaseSchema.extend({
  reasonCode: z.string().min(1).optional(),
  reasonMessage: z.string().min(1).optional(),
});

const PaymentIntentCancelledSchema = PaymentIntentEventBaseSchema.extend({
  reasonCode: z.string().min(1).optional(),
  reasonMessage: z.string().min(1).optional(),
});

const PaymentIntentSupersededSchema = PaymentIntentEventBaseSchema.extend({
  reasonCode: z.string().min(1).optional(),
  reasonMessage: z.string().min(1).optional(),
});

const PaymentReconcileRequiredSchema = PaymentIntentEventBaseSchema.extend({
  reasonCode: z.string().min(1),
  reasonMessage: z.string().min(1),
  requiresManualAction: z.boolean(),
  manualQueueItemId: z.string().nullable().optional(),
  manualQueueItemIds: z.array(z.string()).optional(),
});

const RefundAllocationItemSchema = z.object({
  legId: z.string().min(1),
  amount: z.number().int().positive(),
});

const RefundRequestedSchema = z.object({
  refundId: z.string().min(1),
  intentId: z.string().min(1),
  referenceType: PaymentReferenceTypeSchema,
  referenceId: z.string().min(1),
  userId: z.string().min(1),
  refundAmount: z.number().int().positive(),
  currency: z.string().min(1),
  allocation: z.array(RefundAllocationItemSchema).min(1),
  occurredAt: z.string().datetime(),
});

const RefundCompletedSchema = RefundRequestedSchema;

const RefundFailedSchema = RefundRequestedSchema.extend({
  reasonCode: z.string().min(1),
  reasonMessage: z.string().min(1),
  requiresManualAction: z.boolean(),
  manualQueueItemId: z.string().nullable().optional(),
  manualQueueItemIds: z.array(z.string()).optional(),
});

const CommandCommonSchema = z.object({
  requestedBy: z.string().min(1),
  requestSource: z.string().min(1),
  idempotencyKey: z.string().min(1),
});

const CreatePaymentIntentCommandSchema = CommandCommonSchema.extend({
  referenceType: PaymentReferenceTypeSchema,
  referenceId: z.string().min(1),
  userId: z.string().min(1),
  currency: z.string().min(1),
  payableAmount: z.number().int().nonnegative(),
  snapshotPayload: z.record(z.string(), z.unknown()),
  signature: z.string().min(1),
  signatureVersion: z.string().min(1),
  signedAt: z.string().datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  billingContext: z.record(z.string(), z.unknown()).optional(),
});

const StartPaymentLegCommandSchema = CommandCommonSchema.extend({
  intentId: z.string().min(1),
  legId: z.string().min(1),
  providerType: z.string().min(1),
  amount: z.number().int().positive(),
  operation: z.enum(['AUTHORIZE', 'CAPTURE']).optional(),
});

const CancelPaymentIntentCommandSchema = CommandCommonSchema.extend({
  intentId: z.string().min(1),
});

const ExpirePaymentIntentCommandSchema = CommandCommonSchema.extend({
  intentId: z.string().min(1),
});

const SupersedePaymentIntentCommandSchema = CommandCommonSchema.extend({
  intentId: z.string().min(1),
});

const RequestRefundCommandSchema = CommandCommonSchema.extend({
  intentId: z.string().min(1),
  refundAmount: z.number().int().positive(),
  allocation: z.array(RefundAllocationItemSchema).min(1),
  reasonCode: z.string().min(1),
  reasonMessage: z.string().optional(),
});

const RetryReconcileCommandSchema = CommandCommonSchema.extend({
  intentId: z.string().min(1).optional(),
  legId: z.string().min(1).optional(),
  reasonCode: z.string().min(1),
  reasonMessage: z.string().optional(),
  force: z.boolean().optional(),
}).refine((payload) => payload.intentId || payload.legId, {
  message: 'Either intentId or legId is required',
});

export const PAYMENTS_EVENTS_V1_STREAM = stream({
  topic: 'payments.events.v1',
  partitions: 6,
  aggregateType: 'PaymentIntent',
  events: {
    PaymentIntentSucceeded: event<
      'PaymentIntentSucceeded',
      PaymentIntentSucceededPayload
    >('PaymentIntentSucceeded', PaymentIntentSucceededSchema),
    PaymentIntentFailed: event<
      'PaymentIntentFailed',
      PaymentIntentFailedPayload
    >('PaymentIntentFailed', PaymentIntentFailedSchema),
    PaymentIntentExpired: event<
      'PaymentIntentExpired',
      PaymentIntentExpiredPayload
    >('PaymentIntentExpired', PaymentIntentExpiredSchema),
    PaymentIntentCancelled: event<
      'PaymentIntentCancelled',
      PaymentIntentCancelledPayload
    >('PaymentIntentCancelled', PaymentIntentCancelledSchema),
    PaymentIntentSuperseded: event<
      'PaymentIntentSuperseded',
      PaymentIntentSupersededPayload
    >('PaymentIntentSuperseded', PaymentIntentSupersededSchema),
    PaymentReconcileRequired: event<
      'PaymentReconcileRequired',
      PaymentReconcileRequiredPayload
    >('PaymentReconcileRequired', PaymentReconcileRequiredSchema),
    RefundRequested: event<'RefundRequested', RefundRequestedV1Payload>(
      'RefundRequested',
      RefundRequestedSchema,
    ),
    RefundCompleted: event<'RefundCompleted', RefundCompletedV1Payload>(
      'RefundCompleted',
      RefundCompletedSchema,
    ),
    RefundFailed: event<'RefundFailed', RefundFailedV1Payload>(
      'RefundFailed',
      RefundFailedSchema,
    ),
  },
});

export const PAYMENTS_COMMANDS_V1_STREAM = stream({
  topic: 'payments.commands.v1',
  partitions: 3,
  aggregateType: 'PaymentIntent',
  events: {
    CreatePaymentIntent: event<
      'CreatePaymentIntent',
      CreatePaymentIntentCommandPayload
    >('CreatePaymentIntent', CreatePaymentIntentCommandSchema),
    StartPaymentLeg: event<'StartPaymentLeg', StartPaymentLegCommandPayload>(
      'StartPaymentLeg',
      StartPaymentLegCommandSchema,
    ),
    CancelPaymentIntent: event<
      'CancelPaymentIntent',
      CancelPaymentIntentCommandPayload
    >('CancelPaymentIntent', CancelPaymentIntentCommandSchema),
    ExpirePaymentIntent: event<
      'ExpirePaymentIntent',
      ExpirePaymentIntentCommandPayload
    >('ExpirePaymentIntent', ExpirePaymentIntentCommandSchema),
    SupersedePaymentIntent: event<
      'SupersedePaymentIntent',
      SupersedePaymentIntentCommandPayload
    >('SupersedePaymentIntent', SupersedePaymentIntentCommandSchema),
    RequestRefund: event<'RequestRefund', RequestRefundCommandPayload>(
      'RequestRefund',
      RequestRefundCommandSchema,
    ),
    RetryReconcile: event<'RetryReconcile', RetryReconcileCommandPayload>(
      'RetryReconcile',
      RetryReconcileCommandSchema,
    ),
  },
});

export type PaymentsEventsV1 = typeof PAYMENTS_EVENTS_V1_STREAM.events;
export type PaymentsCommandsV1 = typeof PAYMENTS_COMMANDS_V1_STREAM.events;
