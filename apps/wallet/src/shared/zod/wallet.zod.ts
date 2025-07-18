// wallet.zod.ts
import { z } from 'zod';

// ⛳ 1. 공통 유틸리티 및 Enum (내부용)
// ────────────────────────────────────────────────────────────────
const ID = {
  ULID: z.string().length(26, 'ULID must be 26 characters long'),
  TSID: z.string().length(26, 'TSID must be 26 characters long'),
  BigIntId: z.number().int().positive('ID must be a positive integer'),
};
const AmountSchema = z.number().positive('Amount must be a positive number');
const CurrencySchema = z
  .string()
  .length(3, 'Currency must be a 3-character code');
const ActorEnum = z.enum(['USER', 'SCHEDULER', 'ADMIN', 'SYSTEM']);

// =================================================================
// 🔵 2. 도메인별 스키마 정의
// =================================================================

// --- PaymentMethod & CardMethod ---
// ────────────────────────────────────────────────────────────────
const MethodTypeEnum = z.enum(['CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT']);
const MethodStatusEnum = z.enum([
  'PENDING',
  'ACTIVE',
  'FAILED',
  'INACTIVE',
  'DELETED',
]);

export const PaymentMethodSchema = z.object({
  id: ID.ULID,
  userId: z.string().max(64),
  methodType: MethodTypeEnum,
  methodName: z.string().max(64),
  isDefault: z.boolean().default(false),
  institutionCode: z.string().max(32),
  status: MethodStatusEnum.default('PENDING'),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreatePaymentMethodPayloadSchema = PaymentMethodSchema.omit({
  id: true,
  status: true,
  createdAt: true,
  updatedAt: true,
});

// 결제수단 인증 결과 콜백용 (status ACTIVE | FAILED)
export const VerifyPaymentMethodStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'FAILED']),
});

export const CardMethodSchema = z.object({
  id: ID.ULID,
  methodType: z.literal('CARD'),
  pgToken: z.string().max(128),
  billingKey: z.string().max(128),
  maskedCardNumber: z.string().max(32),
  lastFourDigits: z.string().length(4).optional(),
  cardBrand: z.string().max(32).optional(),
  cardType: z.string().max(32).optional(),
  issuerName: z.string().max(64).optional(),
  createdAt: z.date(),
});

// --- BNPL (Buy Now, Pay Later) ---
// ────────────────────────────────────────────────────────────────
const BnplStatusEnum = z.enum(['ACTIVE', 'INACTIVE', 'OVERDUE', 'SUSPENDED']);
const ActivationTypeEnum = z.enum(['ACTIVATED', 'DEACTIVATED']);
const BnplTransactionTypeEnum = z.enum(['DEBIT', 'CREDIT']);
const BnplTransactionStatusEnum = z.enum(['AUTHORIZED', 'CAPTURED', 'VOIDED']);

export const BnplAccountSchema = z.object({
  id: ID.TSID,
  userId: z.string().max(64),
  paymentMethodId: ID.ULID,
  creditLimit: AmountSchema,
  approvedLimit: AmountSchema,
  currentBalance: AmountSchema.default(0),
  status: BnplStatusEnum.default('ACTIVE'),
  billingCycleDay: z.number().int().min(1).max(31),
  termsUrl: z.string().url().optional(),
  version: z.number().int().default(1),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateBnplAccountPayloadSchema = BnplAccountSchema.omit({
  id: true,
  currentBalance: true,
  status: true,
  version: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateBnplAccountStatusPayloadSchema = BnplAccountSchema.pick({
  status: true,
});

export const BnplActivationEventSchema = z.object({
  id: ID.TSID,
  paymentMethodId: ID.ULID,
  bnplAccountId: ID.TSID,
  eventType: ActivationTypeEnum,
  actor: ActorEnum,
  createdAt: z.date(),
});

export const BnplTransactionSchema = z.object({
  id: ID.ULID,
  bnplAccountId: ID.TSID,
  invoiceId: ID.BigIntId,
  transactionType: BnplTransactionTypeEnum,
  status: BnplTransactionStatusEnum,
  amount: AmountSchema,
  createdAt: z.date(),
});

// --- Settlement ---
// ────────────────────────────────────────────────────────────────
const SettlementStatusEnum = z.enum([
  'PENDING',
  'PROCESSING',
  'SETTLED',
  'FAILED',
  'CANCELLED',
]);
const SettlementEventTypeEnum = z.enum([
  'BATCH_STARTED',
  'ITEM_PROCESSING',
  'ITEM_AUTHORIZED',
  'ITEM_CAPTURED',
  'ITEM_FAILED',
  'BATCH_COMPLETED',
  'BATCH_FAILED',
]);
const SettlementEventStatusEnum = z.enum([
  'PROCESSING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
]);

export const SettlementBatchSchema = z.object({
  id: ID.ULID,
  bnplAccountId: ID.TSID,
  batchNumber: z.string().max(50),
  totalAmount: AmountSchema.default(0),
  dueDate: z.date(),
  status: SettlementStatusEnum.default('PENDING'),
  batchPeriodStart: z.date(),
  batchPeriodEnd: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const SettlementBatchItemSchema = z.object({
  id: ID.ULID,
  batchId: ID.ULID,
  bnplTransactionId: ID.ULID,
  amount: AmountSchema,
  transactionDate: z.date(),
  createdAt: z.date(),
});

export const SettlementProcessEventSchema = z.object({
  id: ID.ULID,
  batchId: ID.ULID,
  batchItemId: ID.ULID.optional(),
  eventType: SettlementEventTypeEnum,
  status: SettlementEventStatusEnum,
  paymentEventId: ID.ULID.optional(),
  errorMessage: z.string().optional(),
  metadata: z.string().optional(),
  actor: ActorEnum.default('SCHEDULER'),
  createdAt: z.date(),
});

export const CreateSettlementProcessEventPayloadSchema =
  SettlementProcessEventSchema.omit({
    id: true,
    createdAt: true,
  });
export const SettlementBatchItemWithTransactionSchema =
  SettlementBatchItemSchema.extend({
    bnplTransaction: BnplTransactionSchema,
  });
// --- Invoice ---
// ────────────────────────────────────────────────────────────────
const InvoiceStatusEnum = z.enum([
  'ISSUED',
  'PAID',
  'PARTIALLY_REFUNDED',
  'REFUNDED',
  'CANCELLED',
  'EXPIRED',
  'OVERDUE',
  'FAILED',
]);

export const InvoiceSchema = z.object({
  id: ID.BigIntId,
  userId: z.string().max(64),
  invoiceNumber: z.string().max(64),
  invoiceType: z.string().max(32),
  amount: AmountSchema,
  refundedAmount: AmountSchema.default(0),
  currency: CurrencySchema,
  status: InvoiceStatusEnum,
  issuedAt: z.date(),
  expiresAt: z.date(),
  dueAt: z.date().nullable().optional(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const CreateInvoicePayloadSchema = InvoiceSchema.omit({
  id: true,
  invoiceNumber: true,
  refundedAmount: true,
  status: true,
  issuedAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
});

export const UpdateInvoiceStatusPayloadSchema = InvoiceSchema.pick({
  status: true,
}).extend({
  reason: z.string().optional(),
});

export const InvoiceEventSchema = z.object({
  id: ID.BigIntId,
  eventUuid: z.string().max(64),
  invoiceId: ID.BigIntId,
  eventType: z.string().max(32),
  reason: z.string().max(255).optional(),
  occurredAt: z.date(),
  createdAt: z.date(),
});

export const InvoiceWithEventsSchema = InvoiceSchema.extend({
  events: z.array(InvoiceEventSchema),
});

// --- Payment & Refund Events ---
// ────────────────────────────────────────────────────────────────
const PaymentStatusEnum = z.enum([
  'REQUESTED',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'DUPLICATE_ATTEMPT',
]);
const RefundStatusEnum = z.enum([
  'REQUESTED',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
]);

export const PaymentEventSchema = z.object({
  id: ID.ULID,
  invoiceId: ID.BigIntId,
  paymentMethodId: ID.ULID,
  amount: AmountSchema,
  status: PaymentStatusEnum,
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().optional(),
  actor: ActorEnum,
  errorMessage: z.string().optional(), // 실패 시 사유를 기록하기 위한 필드 추가
  createdAt: z.date(),
  updatedAt: z.date(), // 상태 변경을 추적하기 위한 필드 추가
});

export const CreatePaymentPayloadSchema = PaymentEventSchema.omit({
  id: true,
  createdAt: true,
});

export const UpdatePaymentStatusPayloadSchema = PaymentEventSchema.pick({
  status: true,
}).extend({
  reason: z.string().optional(),
});

export const RefundEventSchema = z.object({
  id: ID.ULID,
  paymentEventId: ID.ULID,
  amount: AmountSchema,
  status: RefundStatusEnum,
  reason: z.string().optional(),
  createdAt: z.date(),
});

// --- Core API Events ---
// ────────────────────────────────────────────────────────────────
const BaseEventSchema = z.object({
  entityId: ID.ULID,
  timestamp: z.date(),
  userId: z.string().max(64),
});

const PaymentRequestedPayloadSchema = z.object({
  amount: AmountSchema,
  currency: CurrencySchema,
  invoiceId: ID.BigIntId,
});

const PaymentAuthorizedPayloadSchema = z.object({
  authorizedAt: z.date(),
});

const PaymentCapturedPayloadSchema = z.object({
  pgTransactionId: z.string().max(255),
  capturedAt: z.date(),
});

const PaymentFailedPayloadSchema = z.object({
  errorCode: z.string(),
  errorMessage: z.string(),
});

export const RequestPaymentPayloadSchema = PaymentEventSchema.pick({
  invoiceId: true,
  paymentMethodId: true,
  amount: true,
  actor: true,
});

// 📍 파생 스키마 2: '승인' 상태 업데이트를 위한 페이로드
export const AuthorizePaymentPayloadSchema = PaymentEventSchema.pick({
  id: true, // 👈 업데이트할 이벤트의 ID
  pgTransactionId: true,
  pgResponse: true,
  actor: true,
});

// 📍 파생 스키마 3: '캡처' 상태 업데이트를 위한 페이로드
export const CapturePaymentPayloadSchema = PaymentEventSchema.pick({
  id: true, // 👈 업데이트할 이벤트의 ID
  actor: true,
});

// 📍 파생 스키마 4: '실패' 상태 업데이트를 위한 페이로드
export const FailPaymentPayloadSchema = PaymentEventSchema.pick({
  id: true, // 👈 업데이트할 이벤트의 ID
  actor: true,
  errorMessage: true,
});

export const PaymentRequestedEventSchema = BaseEventSchema.extend({
  type: z.literal('PAYMENT_REQUESTED'),
  payload: PaymentRequestedPayloadSchema,
});
export const PaymentAuthorizedEventSchema = BaseEventSchema.extend({
  type: z.literal('PAYMENT_AUTHORIZED'),
  payload: PaymentAuthorizedPayloadSchema,
});
export const PaymentCapturedEventSchema = BaseEventSchema.extend({
  type: z.literal('PAYMENT_CAPTURED'),
  payload: PaymentCapturedPayloadSchema,
});
export const PaymentFailedEventSchema = BaseEventSchema.extend({
  type: z.literal('PAYMENT_FAILED'),
  payload: PaymentFailedPayloadSchema,
});

export const CreateBnplAccountResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  data: z.object({
    paymentMethod: PaymentMethodSchema,
    bnplAccount: BnplAccountSchema,
    hmsMember: z.any(), // HMS API에서 사용자가 필요한 부분만 선별
  }),
});
