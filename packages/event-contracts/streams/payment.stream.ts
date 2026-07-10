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
// 인보이스(ADR-0027) — wallet 이 발행하는 정기결제 청구 결과. subscriber 는 이 이벤트만 구독한다.
// eventType 은 도트 표기('invoice.paid' 등) — wallet outbox dispatcher 가 그대로 messageType 으로 싣는다.
// ==========================================

export interface InvoicePaidPayload {
  invoiceId: string;
  subscriberType: string;
  subscriberRef: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency: string;
  /** 성공한 시도 intent. 재발행(자가치유) 시 빈 문자열일 수 있다. */
  intentId: string;
  paidAt: string;
  occurredAt: string;
}

export interface InvoicePaymentFailedPayload {
  invoiceId: string;
  subscriberType: string;
  subscriberRef: string;
  attemptCount: number;
  maxAttempts: number;
  nextAttemptAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  intentId: string | null;
  occurredAt: string;
}

export interface InvoiceUncollectiblePayload {
  invoiceId: string;
  subscriberType: string;
  subscriberRef: string;
  periodStart: string;
  periodEnd: string;
  errorCode: string | null;
  errorMessage: string | null;
  intentId: string | null;
  occurredAt: string;
}

export interface MandateRejectedPayload {
  /** 인보이스 생성 전 결제수단 부재로 거절되면 null */
  invoiceId: string | null;
  billingMethodId: string | null;
  subscriberType: string;
  subscriberRef: string;
  reasonCode: string | null;
  reason: string | null;
  /** invoiceId 가 null 인 경우의 안정 멱등 키(CreateInvoice idempotencyKey) */
  idempotencyKey?: string;
  occurredAt: string;
}

export interface InvoiceVoidedPayload {
  invoiceId: string;
  subscriberType: string;
  subscriberRef: string;
  periodStart: string;
  periodEnd: string;
  reason: string | null;
  intentId: string | null;
  occurredAt: string;
}

// ==========================================
// payment.intent.* — wallet outbox dispatcher 가 결제 인텐트 상태 전이마다 발행하는 도트-표기 이벤트.
// 발행측 상수는 apps/wallet 의 GatewayEventType(gateway-event.builder.ts) 이며 이 계약과 문자열이 일치한다.
// 소비: channel-adapter(Medusa 전달), membership 레거시 CHARGE 경로(billing-result.consumer).
// payload 는 buildPaymentIntentEventPayload 공통 형태 + 인텐트별 extra(구독 라우팅 subscriberRef/Type 등)라
// passthrough 로 확장 필드를 보존한다.
// ==========================================

export interface PaymentIntentEventPayload {
  intentId: string;
  userId: string;
  status: string;
  payableAmount: number;
  currency: string;
  occurredAt: string;
  /** 정기결제 청구 인텐트의 구독 라우팅(intent.metadata 에서 승격) — 구독과 무관하면 없음 */
  subscriberRef?: string;
  subscriberType?: string;
  purpose?: string;
  [key: string]: unknown;
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

// 인보이스(ADR-0027) 스키마
const InvoicePaidSchema = z.object({
  invoiceId: z.string().min(1),
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
  intentId: z.string(),
  paidAt: z.string().min(1),
  occurredAt: z.string().min(1),
});

const InvoicePaymentFailedSchema = z.object({
  invoiceId: z.string().min(1),
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  attemptCount: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextAttemptAt: z.string().min(1),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  intentId: z.string().nullable(),
  occurredAt: z.string().min(1),
});

const InvoiceUncollectibleSchema = z.object({
  invoiceId: z.string().min(1),
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  intentId: z.string().nullable(),
  occurredAt: z.string().min(1),
});

const MandateRejectedSchema = z.object({
  invoiceId: z.string().nullable(),
  billingMethodId: z.string().nullable(),
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  reasonCode: z.string().nullable(),
  reason: z.string().nullable(),
  idempotencyKey: z.string().optional(),
  occurredAt: z.string().min(1),
});

const InvoiceVoidedSchema = z.object({
  invoiceId: z.string().min(1),
  subscriberType: z.string().min(1),
  subscriberRef: z.string().min(1),
  periodStart: z.string().min(1),
  periodEnd: z.string().min(1),
  reason: z.string().nullable(),
  intentId: z.string().nullable(),
  occurredAt: z.string().min(1),
});

// payment.intent.* 공통 스키마.
// 이 이벤트 계열은 계약화 이전부터 wallet outbox 로 발행돼 channel-adapter(→Medusa 주문 흐름) 등이
// validateOnConsume 로 소비하고 있었다. 계약 등록만으로 소비검증이 켜져 라이브 주문 트래픽이 DLQ 로
// 새는 회귀를 막기 위해, 스키마는 의도적으로 관대하게(전 필드 optional + passthrough) 둔다.
// 기대 형태는 위 PaymentIntentEventPayload 인터페이스가 문서화한다.
// 런타임은 관대하게(전 필드 optional) 검증하되, 소비자 타입 힌트는 위 인터페이스로 rich 하게 유지한다.
const PaymentIntentEventSchema = z
  .object({
    intentId: z.string().optional(),
    userId: z.string().optional(),
    status: z.string().optional(),
    payableAmount: z.number().optional(),
    currency: z.string().optional(),
    occurredAt: z.string().optional(),
    subscriberRef: z.string().optional(),
    subscriberType: z.string().optional(),
    purpose: z.string().optional(),
  })
  .catchall(z.unknown()) as unknown as z.ZodType<PaymentIntentEventPayload>;

export const PAYMENT_STREAM = stream({
  topic: 'payments.events.v1',
  partitions: 6,
  aggregateType: 'Payment',
  events: {
    // --- Core Payment Events (SoT) ---
    PaymentCaptured: event<'PaymentCaptured', PaymentCapturedPayload>('PaymentCaptured', PaymentCapturedSchema),
    PaymentRefundRequest: event<'PaymentRefundRequest', PaymentRefundRequestPayload>(
      'PaymentRefundRequest',
      PaymentRefundRequestSchema,
    ),
    PaymentRefundCompleted: event<'PaymentRefundCompleted', PaymentRefundCompletedPayload>(
      'PaymentRefundCompleted',
      PaymentRefundCompletedSchema,
    ),

    // --- Imported Payment Events ---
    PaymentAuthorized: event<'PaymentAuthorized', PaymentAuthorizedPayload>(
      'PaymentAuthorized',
      PaymentAuthorizedSchema,
    ),
    PaymentFailed: event<'PaymentFailed', PaymentFailedPayload>('PaymentFailed', PaymentFailedSchema),
    PaymentCancelled: event<'PaymentCancelled', PaymentCancelledPayload>('PaymentCancelled', PaymentCancelledSchema),

    // --- Imported Refund Events (Intermediate States) ---
    // RefundRequested, RefundCompleted는 위 SoT 이벤트로 대체
    RefundApproved: event<'RefundApproved', RefundApprovedPayload>('RefundApproved', RefundApprovedSchema),
    RefundRejected: event<'RefundRejected', RefundRejectedPayload>('RefundRejected', RefundRejectedSchema),
    RefundFailed: event<'RefundFailed', RefundFailedPayload>('RefundFailed', RefundFailedSchema),

    // --- BNPL Events ---
    BnplAccountCreated: event<'BnplAccountCreated', BnplAccountCreatedPayload>(
      'BnplAccountCreated',
      BnplAccountCreatedSchema,
    ),
    BnplCreditUsed: event<'BnplCreditUsed', BnplCreditUsedPayload>('BnplCreditUsed', BnplCreditUsedSchema),
    BnplPurchaseCompleted: event<'BnplPurchaseCompleted', BnplPurchaseCompletedPayload>(
      'BnplPurchaseCompleted',
      BnplPurchaseCompletedSchema,
    ),
    BnplRepaymentSuccess: event<'BnplRepaymentSuccess', BnplRepaymentSuccessPayload>(
      'BnplRepaymentSuccess',
      BnplRepaymentSuccessSchema,
    ),
    BnplRepaymentFailed: event<'BnplRepaymentFailed', BnplRepaymentFailedPayload>(
      'BnplRepaymentFailed',
      BnplRepaymentFailedSchema,
    ),
    BnplSettlementCompleted: event<'BnplSettlementCompleted', BnplSettlementCompletedPayload>(
      'BnplSettlementCompleted',
      BnplSettlementCompletedSchema,
    ),
    BnplSettlementFailed: event<'BnplSettlementFailed', BnplSettlementFailedPayload>(
      'BnplSettlementFailed',
      BnplSettlementFailedSchema,
    ),

    // --- Point Events ---
    PointsEarned: event<'PointsEarned', PointsEarnedPayload>('PointsEarned', PointsEarnedSchema),
    PointsRedeemed: event<'PointsRedeemed', PointsRedeemedPayload>('PointsRedeemed', PointsRedeemedSchema),
    PointsCancelled: event<'PointsCancelled', PointsCancelledPayload>('PointsCancelled', PointsCancelledSchema),
    PointsExpired: event<'PointsExpired', PointsExpiredPayload>('PointsExpired', PointsExpiredSchema),

    // --- Tax Invoice Events ---
    TaxInvoiceIssued: event<'TaxInvoiceIssued', TaxInvoiceIssuedPayload>('TaxInvoiceIssued', TaxInvoiceIssuedSchema),
    TaxInvoiceFailed: event<'TaxInvoiceFailed', TaxInvoiceFailedPayload>('TaxInvoiceFailed', TaxInvoiceFailedSchema),
    TaxInvoiceCancelled: event<'TaxInvoiceCancelled', TaxInvoiceCancelledPayload>(
      'TaxInvoiceCancelled',
      TaxInvoiceCancelledSchema,
    ),
    // --- Invoice Events (ADR-0027, wallet 발행) ---
    'invoice.paid': event<'invoice.paid', InvoicePaidPayload>('invoice.paid', InvoicePaidSchema),
    'invoice.payment_failed': event<'invoice.payment_failed', InvoicePaymentFailedPayload>(
      'invoice.payment_failed',
      InvoicePaymentFailedSchema,
    ),
    'invoice.uncollectible': event<'invoice.uncollectible', InvoiceUncollectiblePayload>(
      'invoice.uncollectible',
      InvoiceUncollectibleSchema,
    ),
    'mandate.rejected': event<'mandate.rejected', MandateRejectedPayload>('mandate.rejected', MandateRejectedSchema),
    'invoice.voided': event<'invoice.voided', InvoiceVoidedPayload>('invoice.voided', InvoiceVoidedSchema),

    // --- Payment Intent Events (wallet outbox dispatcher, 도트 표기) ---
    'payment.intent.created': event<'payment.intent.created', PaymentIntentEventPayload>(
      'payment.intent.created',
      PaymentIntentEventSchema,
    ),
    'payment.intent.authorized': event<'payment.intent.authorized', PaymentIntentEventPayload>(
      'payment.intent.authorized',
      PaymentIntentEventSchema,
    ),
    'payment.intent.succeeded': event<'payment.intent.succeeded', PaymentIntentEventPayload>(
      'payment.intent.succeeded',
      PaymentIntentEventSchema,
    ),
    'payment.intent.captured': event<'payment.intent.captured', PaymentIntentEventPayload>(
      'payment.intent.captured',
      PaymentIntentEventSchema,
    ),
    'payment.intent.partially_captured': event<'payment.intent.partially_captured', PaymentIntentEventPayload>(
      'payment.intent.partially_captured',
      PaymentIntentEventSchema,
    ),
    'payment.intent.failed': event<'payment.intent.failed', PaymentIntentEventPayload>(
      'payment.intent.failed',
      PaymentIntentEventSchema,
    ),
    'payment.intent.canceled': event<'payment.intent.canceled', PaymentIntentEventPayload>(
      'payment.intent.canceled',
      PaymentIntentEventSchema,
    ),
    'payment.intent.awaiting_deposit': event<'payment.intent.awaiting_deposit', PaymentIntentEventPayload>(
      'payment.intent.awaiting_deposit',
      PaymentIntentEventSchema,
    ),
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
