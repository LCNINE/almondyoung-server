/**
 * Payment Domain Stream Configuration (Unified)
 *
 * 결제, 환불, BNPL, 포인트, 세금계산서 등 모든 결제 관련 이벤트를 정의합니다.
 * PaymentStream을 Source of Truth로 하여 WalletStream을 통합했습니다.
 */

import { event, stream, EventType, StreamConfig } from '../types';
import { z } from 'zod';

// ==========================================
// 1. Payload 타입 정의
// ==========================================

// [SoT] Payment Stream Core Payloads
export interface PaymentCapturedPayload {
  orderId: string;
  paymentId: string;
  amount: number;
  currencyCode: string;
  createdAt: string; // ISO 8601
}

export interface PaymentRefundRequestPayload {
  refundId: string;
  userId: string;
  paymentEventId: string;
  amount: number;
  reason?: string;
}

export interface PaymentRefundCompletedPayload {
  refundId: string;
  paymentId: string;
  orderId?: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
  metadata?: Record<string, unknown>;
  completedAt: string; // ISO 8601
}

// [Imported] From Wallet Stream - Payment Extras
export interface PaymentAuthorizedPayload {
  intentId: string;
  paymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  providerType: string;
  providerTransactionId?: string;
  orderId?: string;
  metadata?: Record<string, any>;
  authorizedAt: string;
}

export interface PaymentFailedPayload {
  intentId: string;
  paymentId?: string;
  customerId: string;
  amount: number;
  currency: string;
  providerType: string;
  errorCode: string;
  errorMessage: string;
  orderId?: string;
  isRetryable?: boolean;
  failedAt: string;
}

export interface PaymentCancelledPayload {
  intentId: string;
  paymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  reason: string;
  cancelledBy?: string;
  orderId?: string;
  cancelledAt: string;
}

// [Imported] From Wallet Stream - Refund Extras (Intermediate states)
export interface RefundApprovedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  orderId?: string;
  returnId?: string;
  approvedBy?: string;
  approvalReason?: string;
  approvedAt: string;
}

export interface RefundRejectedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  orderId?: string;
  returnId?: string;
  rejectionReason: string;
  rejectionDetail?: string;
  rejectedBy?: string;
  requiresCustomerContact: boolean;
  rejectedAt: string;
}

export interface RefundFailedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  customerId: string;
  amount: number;
  currency: string;
  errorCode: string;
  errorMessage: string;
  orderId?: string;
  requiresManualProcessing: boolean;
  failedAt: string;
}

// [Imported] From Wallet Stream - BNPL
export interface BnplAccountCreatedPayload {
  accountId: string;
  userId: string;
  creditLimit: number;
  availableCredit: number;
  currency: string;
  status: string;
  provider: string;
  createdAt: string;
}

export interface BnplCreditUsedPayload {
  accountId: string;
  userId: string;
  transactionId: string;
  amount: number;
  currency: string;
  remainingCredit: number;
  orderId?: string;
  settlementDueDate?: string;
  usedAt: string;
}

export interface BnplPurchaseCompletedPayload {
  purchaseId: string;
  customerId: string;
  amount: number;
  currency: string;
  creditUsed: number;
  remainingCredit: number;
  orderId?: string;
  dueDate?: string;
  purchasedAt: string;
}

export interface BnplRepaymentSuccessPayload {
  repaymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  creditRestored: number;
  remainingCredit: number;
  repaidAt: string;
}

export interface BnplRepaymentFailedPayload {
  repaymentId: string;
  customerId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  failureReason: string;
  retryScheduled: boolean;
  retryCount: number;
  failedAt: string;
}

export interface BnplSettlementCompletedPayload {
  settlementId: string;
  accountId: string;
  userId: string;
  amount: number;
  currency: string;
  orderId?: string;
  cmsTransactionId?: string;
  restoredCredit: number;
  completedAt: string;
}

export interface BnplSettlementFailedPayload {
  settlementId: string;
  accountId: string;
  userId: string;
  amount: number;
  currency: string;
  errorCode: string;
  errorMessage: string;
  orderId?: string;
  retryCount: number;
  nextRetryAt?: string;
  requiresSuspension: boolean;
  failedAt: string;
}

// [Imported] From Wallet Stream - Points
export interface PointsEarnedPayload {
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;
  reason: string;
  orderId?: string;
  expiresAt?: string;
  earnedAt: string;
}

export interface PointsRedeemedPayload {
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;
  reason: string;
  orderId?: string;
  redeemedAt: string;
}

export interface PointsCancelledPayload {
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;
  reason: string;
  orderId?: string;
  cancelledAt: string;
}

export interface PointsExpiredPayload {
  pointId: string;
  partnerId: string;
  userId?: string;
  amount: number;
  earnedAt: string;
  expiredAt: string;
}

// [Imported] From Wallet Stream - Tax Invoice
export interface TaxInvoiceIssuedPayload {
  invoiceId: string;
  customerId: string;
  orderId?: string;
  paymentId?: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  issueDate: string;
  businessNumber: string;
  businessName?: string;
  email?: string;
  omsInvoiceId?: string;
  issuedAt: string;
}

export interface TaxInvoiceFailedPayload {
  invoiceId: string;
  customerId: string;
  orderId?: string;
  paymentId?: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  errorCode: string;
  errorMessage: string;
  businessNumber: string;
  failedAt: string;
}

export interface TaxInvoiceCancelledPayload {
  invoiceId: string;
  customerId: string;
  orderId?: string;
  reason: string;
  reasonDetail?: string;
  cancelledBy?: string;
  cancelledAt: string;
}

// ==========================================
// 2. Zod 스키마 정의
// ==========================================

// [SoT] Core Payment Schemas
const PaymentCapturedSchema = z.object({
  orderId: z.string().min(1),
  paymentId: z.string().min(1),
  amount: z.number().nonnegative(),
  currencyCode: z.string().min(1),
  createdAt: z.string().datetime(),
});

const PaymentRefundRequestSchema = z.object({
  refundId: z.string().min(1),
  userId: z.string().min(1),
  paymentEventId: z.string().min(1),
  amount: z.number().nonnegative(),
  reason: z.string().optional(),
});

const PaymentRefundCompletedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  orderId: z.string().optional(),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  status: z.enum(['pending', 'succeeded', 'failed']),
  metadata: z.record(z.string(), z.unknown()).optional(),
  completedAt: z.string().datetime(),
});

// [Imported] Payment Extra Schemas
const PaymentAuthorizedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  providerTransactionId: z.string().optional(),
  orderId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  authorizedAt: z.string().datetime(),
});

const PaymentFailedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().optional(),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  orderId: z.string().optional(),
  isRetryable: z.boolean().optional(),
  failedAt: z.string().datetime(),
});

const PaymentCancelledSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  reason: z.string().min(1),
  cancelledBy: z.string().optional(),
  orderId: z.string().optional(),
  cancelledAt: z.string().datetime(),
});

// [Imported] Refund Extra Schemas
const RefundApprovedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  orderId: z.string().optional(),
  returnId: z.string().optional(),
  approvedBy: z.string().optional(),
  approvalReason: z.string().optional(),
  approvedAt: z.string().datetime(),
});

const RefundRejectedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  orderId: z.string().optional(),
  returnId: z.string().optional(),
  rejectionReason: z.string().min(1),
  rejectionDetail: z.string().optional(),
  rejectedBy: z.string().optional(),
  requiresCustomerContact: z.boolean(),
  rejectedAt: z.string().datetime(),
});

const RefundFailedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  orderId: z.string().optional(),
  requiresManualProcessing: z.boolean(),
  failedAt: z.string().datetime(),
});

// [Imported] BNPL Schemas
const BnplAccountCreatedSchema = z.object({
  accountId: z.string().min(1),
  userId: z.string().min(1),
  creditLimit: z.number().nonnegative(),
  availableCredit: z.number().nonnegative(),
  currency: z.string().min(1),
  status: z.string().min(1),
  provider: z.string().min(1),
  createdAt: z.string().datetime(),
});

const BnplCreditUsedSchema = z.object({
  accountId: z.string().min(1),
  userId: z.string().min(1),
  transactionId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  remainingCredit: z.number().nonnegative(),
  orderId: z.string().optional(),
  settlementDueDate: z.string().datetime().optional(),
  usedAt: z.string().datetime(),
});

const BnplPurchaseCompletedSchema = z.object({
  purchaseId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  creditUsed: z.number().nonnegative(),
  remainingCredit: z.number().nonnegative(),
  orderId: z.string().optional(),
  dueDate: z.string().datetime().optional(),
  purchasedAt: z.string().datetime(),
});

const BnplRepaymentSuccessSchema = z.object({
  repaymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  paymentMethod: z.string().min(1),
  creditRestored: z.number().nonnegative(),
  remainingCredit: z.number().nonnegative(),
  repaidAt: z.string().datetime(),
});

const BnplRepaymentFailedSchema = z.object({
  repaymentId: z.string().min(1),
  customerId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  paymentMethod: z.string().min(1),
  failureReason: z.string().min(1),
  retryScheduled: z.boolean(),
  retryCount: z.number().int().nonnegative(),
  failedAt: z.string().datetime(),
});

const BnplSettlementCompletedSchema = z.object({
  settlementId: z.string().min(1),
  accountId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  orderId: z.string().optional(),
  cmsTransactionId: z.string().optional(),
  restoredCredit: z.number().nonnegative(),
  completedAt: z.string().datetime(),
});

const BnplSettlementFailedSchema = z.object({
  settlementId: z.string().min(1),
  accountId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  orderId: z.string().optional(),
  retryCount: z.number().int().nonnegative(),
  nextRetryAt: z.string().datetime().optional(),
  requiresSuspension: z.boolean(),
  failedAt: z.string().datetime(),
});

// [Imported] Point Schemas
const PointsEarnedSchema = z.object({
  pointId: z.string().min(1),
  partnerId: z.string().min(1),
  userId: z.string().optional(),
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
  orderId: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  earnedAt: z.string().datetime(),
});

const PointsRedeemedSchema = z.object({
  pointId: z.string().min(1),
  partnerId: z.string().min(1),
  userId: z.string().optional(),
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
  orderId: z.string().optional(),
  redeemedAt: z.string().datetime(),
});

const PointsCancelledSchema = z.object({
  pointId: z.string().min(1),
  partnerId: z.string().min(1),
  userId: z.string().optional(),
  amount: z.number().nonnegative(),
  reason: z.string().min(1),
  orderId: z.string().optional(),
  cancelledAt: z.string().datetime(),
});

const PointsExpiredSchema = z.object({
  pointId: z.string().min(1),
  partnerId: z.string().min(1),
  userId: z.string().optional(),
  amount: z.number().nonnegative(),
  earnedAt: z.string().datetime(),
  expiredAt: z.string().datetime(),
});

// [Imported] Tax Invoice Schemas
const TaxInvoiceIssuedSchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  orderId: z.string().optional(),
  paymentId: z.string().optional(),
  amount: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  issueDate: z.string(),
  businessNumber: z.string().min(1),
  businessName: z.string().optional(),
  email: z.string().email().optional(),
  omsInvoiceId: z.string().optional(),
  issuedAt: z.string().datetime(),
});

const TaxInvoiceFailedSchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  orderId: z.string().optional(),
  paymentId: z.string().optional(),
  amount: z.number().nonnegative(),
  taxAmount: z.number().nonnegative(),
  totalAmount: z.number().nonnegative(),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  businessNumber: z.string().min(1),
  failedAt: z.string().datetime(),
});

const TaxInvoiceCancelledSchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  orderId: z.string().optional(),
  reason: z.string().min(1),
  reasonDetail: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancelledAt: z.string().datetime(),
});

// ==========================================
// 3. Stream Config (Unified)
// ==========================================

export const PAYMENT_STREAM = stream({
  topic: 'payments.events.v1',
  partitions: 6,
  aggregateType: 'Payment',
  events: {
    // --- Core Payment Events (SoT) ---
    PaymentCaptured: event<'PaymentCaptured', PaymentCapturedPayload>(
      'PaymentCaptured',
      PaymentCapturedSchema,
    ),
    PaymentRefundRequest: event<
      'PaymentRefundRequest',
      PaymentRefundRequestPayload
    >('PaymentRefundRequest', PaymentRefundRequestSchema),
    PaymentRefundCompleted: event<
      'PaymentRefundCompleted',
      PaymentRefundCompletedPayload
    >('PaymentRefundCompleted', PaymentRefundCompletedSchema),

    // --- Imported Payment Events ---
    PaymentAuthorized: event<'PaymentAuthorized', PaymentAuthorizedPayload>(
      'PaymentAuthorized',
      PaymentAuthorizedSchema,
    ),
    PaymentFailed: event<'PaymentFailed', PaymentFailedPayload>(
      'PaymentFailed',
      PaymentFailedSchema,
    ),
    PaymentCancelled: event<'PaymentCancelled', PaymentCancelledPayload>(
      'PaymentCancelled',
      PaymentCancelledSchema,
    ),

    // --- Imported Refund Events (Intermediate States) ---
    // RefundRequested, RefundCompleted는 위 SoT 이벤트로 대체
    RefundApproved: event<'RefundApproved', RefundApprovedPayload>(
      'RefundApproved',
      RefundApprovedSchema,
    ),
    RefundRejected: event<'RefundRejected', RefundRejectedPayload>(
      'RefundRejected',
      RefundRejectedSchema,
    ),
    RefundFailed: event<'RefundFailed', RefundFailedPayload>(
      'RefundFailed',
      RefundFailedSchema,
    ),

    // --- BNPL Events ---
    BnplAccountCreated: event<'BnplAccountCreated', BnplAccountCreatedPayload>(
      'BnplAccountCreated',
      BnplAccountCreatedSchema,
    ),
    BnplCreditUsed: event<'BnplCreditUsed', BnplCreditUsedPayload>(
      'BnplCreditUsed',
      BnplCreditUsedSchema,
    ),
    BnplPurchaseCompleted: event<
      'BnplPurchaseCompleted',
      BnplPurchaseCompletedPayload
    >('BnplPurchaseCompleted', BnplPurchaseCompletedSchema),
    BnplRepaymentSuccess: event<
      'BnplRepaymentSuccess',
      BnplRepaymentSuccessPayload
    >('BnplRepaymentSuccess', BnplRepaymentSuccessSchema),
    BnplRepaymentFailed: event<
      'BnplRepaymentFailed',
      BnplRepaymentFailedPayload
    >('BnplRepaymentFailed', BnplRepaymentFailedSchema),
    BnplSettlementCompleted: event<
      'BnplSettlementCompleted',
      BnplSettlementCompletedPayload
    >('BnplSettlementCompleted', BnplSettlementCompletedSchema),
    BnplSettlementFailed: event<
      'BnplSettlementFailed',
      BnplSettlementFailedPayload
    >('BnplSettlementFailed', BnplSettlementFailedSchema),

    // --- Point Events ---
    PointsEarned: event<'PointsEarned', PointsEarnedPayload>(
      'PointsEarned',
      PointsEarnedSchema,
    ),
    PointsRedeemed: event<'PointsRedeemed', PointsRedeemedPayload>(
      'PointsRedeemed',
      PointsRedeemedSchema,
    ),
    PointsCancelled: event<'PointsCancelled', PointsCancelledPayload>(
      'PointsCancelled',
      PointsCancelledSchema,
    ),
    PointsExpired: event<'PointsExpired', PointsExpiredPayload>(
      'PointsExpired',
      PointsExpiredSchema,
    ),

    // --- Tax Invoice Events ---
    TaxInvoiceIssued: event<'TaxInvoiceIssued', TaxInvoiceIssuedPayload>(
      'TaxInvoiceIssued',
      TaxInvoiceIssuedSchema,
    ),
    TaxInvoiceFailed: event<'TaxInvoiceFailed', TaxInvoiceFailedPayload>(
      'TaxInvoiceFailed',
      TaxInvoiceFailedSchema,
    ),
    TaxInvoiceCancelled: event<
      'TaxInvoiceCancelled',
      TaxInvoiceCancelledPayload
    >('TaxInvoiceCancelled', TaxInvoiceCancelledSchema),
  },
});

// ==========================================
// 4. 타입 추론 및 레거시 지원
// ==========================================

export type PaymentEvents = typeof PAYMENT_STREAM.events;

// Medusa 호환성: 레거시 이벤트 토픽 참조
export const PAYMENT_EVENTS = {
  CAPTURED: {
    topic: PAYMENT_STREAM.topic.topic,
    messageType: 'PaymentCaptured' as const,
  },
  REFUND_REQUEST: {
    topic: PAYMENT_STREAM.topic.topic,
    messageType: 'PaymentRefundRequest' as const,
  },
  REFUND_COMPLETED: {
    topic: PAYMENT_STREAM.topic.topic,
    messageType: 'PaymentRefundCompleted' as const,
  },
} as const;
