/**
 * Wallet Domain Stream Configuration
 *
 * 결제, 환불, BNPL, 포인트, 세금계산서 등 Wallet 도메인의 모든 이벤트를 정의합니다.
 */

import { event, stream } from '../types';
import { z } from 'zod';

// ===== Payment 이벤트 Payload =====

export interface PaymentAuthorizedPayload {
  intentId: string;
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  providerType: string;
  providerTransactionId?: string;
  orderId?: string;
  metadata?: Record<string, any>;
  authorizedAt: string;
}

export interface PaymentCapturedPayload {
  intentId: string;
  paymentId: string;
  userId: string;
  amount: number;
  currency: string;
  providerType: string;
  providerTransactionId?: string;
  orderId?: string;
  metadata?: Record<string, any>;
  capturedAt: string;
}

export interface PaymentFailedPayload {
  intentId: string;
  paymentId?: string;
  userId: string;
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
  userId: string;
  amount: number;
  currency: string;
  reason: string;
  cancelledBy?: string;
  orderId?: string;
  cancelledAt: string;
}

// ===== Refund 이벤트 Payload =====

export interface RefundRequestedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  userId: string;
  amount: number;
  currency: string;
  reason: string;
  reasonDetail?: string;
  orderId?: string;
  requestedBy?: string;
  requiresApproval?: boolean;
  requestedAt: string;
}

export interface RefundApprovedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  userId: string;
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
  userId: string;
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

export interface RefundCompletedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  userId: string;
  amount: number;
  currency: string;
  providerRefundId?: string;
  orderId?: string;
  completedAt: string;
}

export interface RefundFailedPayload {
  refundId: string;
  paymentId: string;
  intentId: string;
  userId: string;
  amount: number;
  currency: string;
  errorCode: string;
  errorMessage: string;
  orderId?: string;
  requiresManualProcessing: boolean;
  failedAt: string;
}

// ===== BNPL 이벤트 Payload =====

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
  userId: string;
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
  userId: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  creditRestored: number;
  remainingCredit: number;
  repaidAt: string;
}

export interface BnplRepaymentFailedPayload {
  repaymentId: string;
  userId: string;
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

// ===== Point 이벤트 Payload =====

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

// ===== Tax Invoice 이벤트 Payload =====

export interface TaxInvoiceIssuedPayload {
  invoiceId: string;
  userId: string;
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
  userId: string;
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
  userId: string;
  orderId?: string;
  reason: string;
  reasonDetail?: string;
  cancelledBy?: string;
  cancelledAt: string;
}

// ===== Zod 스키마 정의 =====

// Payment 스키마
const PaymentAuthorizedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  providerTransactionId: z.string().optional(),
  orderId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  authorizedAt: z.string().datetime(),
});

const PaymentCapturedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerType: z.string().min(1),
  providerTransactionId: z.string().optional(),
  orderId: z.string().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  capturedAt: z.string().datetime(),
});

const PaymentFailedSchema = z.object({
  intentId: z.string().min(1),
  paymentId: z.string().optional(),
  userId: z.string().min(1),
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
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  reason: z.string().min(1),
  cancelledBy: z.string().optional(),
  orderId: z.string().optional(),
  cancelledAt: z.string().datetime(),
});

// Refund 스키마
const RefundRequestedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  reason: z.string().min(1),
  reasonDetail: z.string().optional(),
  orderId: z.string().optional(),
  requestedBy: z.string().optional(),
  requiresApproval: z.boolean().optional(),
  requestedAt: z.string().datetime(),
});

const RefundApprovedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  userId: z.string().min(1),
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
  userId: z.string().min(1),
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

const RefundCompletedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  providerRefundId: z.string().optional(),
  orderId: z.string().optional(),
  completedAt: z.string().datetime(),
});

const RefundFailedSchema = z.object({
  refundId: z.string().min(1),
  paymentId: z.string().min(1),
  intentId: z.string().min(1),
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
  orderId: z.string().optional(),
  requiresManualProcessing: z.boolean(),
  failedAt: z.string().datetime(),
});

// BNPL 스키마
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
  userId: z.string().min(1),
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
  userId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  paymentMethod: z.string().min(1),
  creditRestored: z.number().nonnegative(),
  remainingCredit: z.number().nonnegative(),
  repaidAt: z.string().datetime(),
});

const BnplRepaymentFailedSchema = z.object({
  repaymentId: z.string().min(1),
  userId: z.string().min(1),
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

// Point 스키마
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

// Tax Invoice 스키마
const TaxInvoiceIssuedSchema = z.object({
  invoiceId: z.string().min(1),
  userId: z.string().min(1),
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
  userId: z.string().min(1),
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
  userId: z.string().min(1),
  orderId: z.string().optional(),
  reason: z.string().min(1),
  reasonDetail: z.string().optional(),
  cancelledBy: z.string().optional(),
  cancelledAt: z.string().datetime(),
});

// ===== Stream Config =====

export const WALLET_STREAM = stream({
  topic: 'wallet.events.v1',
  partitions: 6,
  aggregateType: 'Wallet',
  events: {
    // Payment 이벤트
    PaymentAuthorized: event<'PaymentAuthorized', PaymentAuthorizedPayload>(
      'PaymentAuthorized',
      PaymentAuthorizedSchema,
    ),
    PaymentCaptured: event<'PaymentCaptured', PaymentCapturedPayload>(
      'PaymentCaptured',
      PaymentCapturedSchema,
    ),
    PaymentFailed: event<'PaymentFailed', PaymentFailedPayload>(
      'PaymentFailed',
      PaymentFailedSchema,
    ),
    PaymentCancelled: event<'PaymentCancelled', PaymentCancelledPayload>(
      'PaymentCancelled',
      PaymentCancelledSchema,
    ),

    // Refund 이벤트
    RefundRequested: event<'RefundRequested', RefundRequestedPayload>(
      'RefundRequested',
      RefundRequestedSchema,
    ),
    RefundApproved: event<'RefundApproved', RefundApprovedPayload>(
      'RefundApproved',
      RefundApprovedSchema,
    ),
    RefundRejected: event<'RefundRejected', RefundRejectedPayload>(
      'RefundRejected',
      RefundRejectedSchema,
    ),
    RefundCompleted: event<'RefundCompleted', RefundCompletedPayload>(
      'RefundCompleted',
      RefundCompletedSchema,
    ),
    RefundFailed: event<'RefundFailed', RefundFailedPayload>(
      'RefundFailed',
      RefundFailedSchema,
    ),

    // BNPL 이벤트
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

    // Point 이벤트
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

    // Tax Invoice 이벤트
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

export type WalletEvents = typeof WALLET_STREAM.events;
