import { z } from 'zod';

// ────────────────────────────────────────────
// BNPL 계정 (BNPL Account)
// ────────────────────────────────────────────

// ────────────────────────────────────────────
// Zod 스키마 (nestjs-zod용)
// ────────────────────────────────────────────

// BNPL 계정 스키마
export const BnplAccountSchema = z.object({
  id: z.string(),
  userId: z.string().min(1).max(64),
  paymentMethodId: z.string(),
  creditLimit: z.number(),
  approvedLimit: z.number(),
  currentBalance: z.number(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'OVERDUE', 'SUSPENDED']),
  billingCycleDay: z.number().int(),
  termsUrl: z.string().url().nullable().optional(),
  version: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
const extraResponseFields = {
  availableCredit: z.number(),
  lastSettlementDate: z.date().nullable(),
};
export const BnplAccountResponseSchema =
  BnplAccountSchema.extend(extraResponseFields);
// BNPL 계정 생성 스키마
export const CreateBnplAccountSchema = z.object({
  userId: z.string().min(1).max(64),
  methodType: z.literal('BNPL'),
  methodName: z.string().min(1).max(64),
  institutionCode: z.string().min(1),
  billingCycleDay: z.number().int().min(1).max(31),
  isDefault: z.boolean().optional(),
  creditLimit: z.number().positive().max(10000000).optional(),
  approvedLimit: z.number().positive().max(10000000).optional(),
  termsUrl: z.string().url().optional(),
  phone: z
    .string()
    .regex(/^01[0-9]{8,9}$/)
    .optional(),
});

// BNPL 거래 스키마
export const BnplTransactionSchema = z.object({
  id: z.string(),
  bnplAccountId: z.string(),
  invoiceId: z.number().int().positive(),
  transactionType: z.enum(['DEBIT', 'CREDIT']),
  status: z.enum(['AUTHORIZED', 'CAPTURED', 'VOIDED']),
  amount: z.number().positive(),
  createdAt: z.date(),
});

// BNPL 거래 생성 스키마
export const CreateBnplTransactionSchema = z.object({
  bnplAccountId: z.string(),
  invoiceId: z.number().int().positive(),
  transactionType: z.enum(['DEBIT', 'CREDIT']),
  status: z.enum(['AUTHORIZED', 'CAPTURED', 'VOIDED']),
  amount: z.number().positive(),
});

// 정산 배치 스키마
export const SettlementBatchSchema = z.object({
  id: z.string(),
  bnplAccountId: z.string(),
  batchNumber: z.string().min(1).max(50),
  totalAmount: z.number().min(0),
  dueDate: z.date(),
  status: z.enum(['PENDING', 'PROCESSING', 'SETTLED', 'FAILED']),
  batchPeriodStart: z.date(),
  batchPeriodEnd: z.date(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// 정산 배치 생성 스키마
export const CreateSettlementBatchSchema = z.object({
  bnplAccountId: z.string(),
  batchNumber: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM 형식
  totalAmount: z.number().min(0),
  dueDate: z.date(),
  status: z.enum(['PENDING', 'PROCESSING', 'SETTLED', 'FAILED']).optional(),
  batchPeriodStart: z.date(),
  batchPeriodEnd: z.date(),
});

// 정산 배치 업데이트 스키마
export const UpdateSettlementBatchSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'SETTLED', 'FAILED']).optional(),
  totalAmount: z.number().min(0).optional(),
  dueDate: z.date().optional(),
  batchPeriodStart: z.date().optional(),
  batchPeriodEnd: z.date().optional(),
});

// BNPL 활성화 이벤트 스키마
export const BnplActivationEventSchema = z.object({
  id: z.string(),
  paymentMethodId: z.string(),
  bnplAccountId: z.string(),
  eventType: z.enum(['ACTIVATED', 'DEACTIVATED']),
  actor: z.enum(['USER', 'ADMIN', 'SYSTEM']),
  createdAt: z.date(),
});

// 타입 추출
export type BnplAccount = z.infer<typeof BnplAccountSchema>;
export type BnplTransaction = z.infer<typeof BnplTransactionSchema>;
export type SettlementBatch = z.infer<typeof SettlementBatchSchema>;
export type BnplActivationEvent = z.infer<typeof BnplActivationEventSchema>;

// PaymentDetails 인터페이스 정의 (서비스에서 사용)
export interface PaymentDetails {
  code: number;
  status: string;
  description?: string;
  message?: string;
  transactionId?: string;
}
