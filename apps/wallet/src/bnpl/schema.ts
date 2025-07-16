import { relations } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  bigint,
  timestamp,
  numeric,
  uniqueIndex,
  integer,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { paymentMethod } from '../shared/schemas/payment-method.schema';

// BNPL 모듈에서 사용할 수 있도록 re-export
export { paymentMethod };

// ────────────────────────────────────────────
// BNPL 계정 (BNPL Account)
// ────────────────────────────────────────────
export const bnplAccount = pgTable(
  'bnpl_account',
  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    paymentMethodId: varchar('payment_method_id', {
      length: 26,
    })
      .notNull()
      .references(() => paymentMethod.id),
    creditLimit: numeric('credit_limit', {
      precision: 18,
      scale: 2,
    })
      .$type<number>()
      .notNull(),
    approvedLimit: numeric('approved_limit', {
      precision: 18,
      scale: 2,
    })
      .$type<number>()
      .notNull(),
    currentBalance: numeric('current_balance', {
      precision: 18,
      scale: 2,
    })
      .$type<number>()
      .notNull()
      .default(0),
    status: text('status')
      .$type<'ACTIVE' | 'INACTIVE' | 'OVERDUE' | 'SUSPENDED'>()
      .notNull()
      .default('ACTIVE'),
    billingCycleDay: integer('billing_cycle_day').notNull(),
    termsUrl: text('terms_url'),
    version: bigint('version', { mode: 'number' }).notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_bnpl_account_user_unique').on(table.userId),
  ],
);

// ────────────────────────────────────────────
// BNPL 활성화 이벤트 (BNPL Activation Event)
// ────────────────────────────────────────────
export const bnplActivationEvent = pgTable(
  'bnpl_activation_event',
  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
    bnplAccountId: varchar('bnpl_account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccount.id),
    eventType: text('event_type')
      .$type<'ACTIVATED' | 'DEACTIVATED'>()
      .notNull(),
    actor: text('actor').$type<'USER' | 'ADMIN' | 'SYSTEM'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_bnpl_activation_payment_method').on(table.paymentMethodId),
  ],
);

// ────────────────────────────────────────────
// BNPL 거래 내역 (BNPL Transaction)
// ────────────────────────────────────────────
export const bnplTransaction = pgTable(
  'bnpl_transaction',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    bnplAccountId: varchar('bnpl_account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccount.id),
    invoiceId: bigint('invoice_id', { mode: 'number' }).notNull(),
    transactionType: text('transaction_type')
      .$type<'DEBIT' | 'CREDIT'>()
      .notNull(),
    status: text('status')
      .$type<'AUTHORIZED' | 'CAPTURED' | 'VOIDED'>()
      .notNull(),
    amount: numeric('amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

// ────────────────────────────────────────────
// 정산 배치 (Settlement Batch)
// ────────────────────────────────────────────
export const settlementBatch = pgTable(
  'settlement_batch',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    bnplAccountId: varchar('bnpl_account_id', { length: 26 })
      .notNull()
      .references(() => bnplAccount.id),
    batchNumber: varchar('batch_number', { length: 50 }).notNull(), // 예: "2025-07"
    totalAmount: numeric('total_amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull()
      .default(0),
    dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'PENDING' | 'PROCESSING' | 'SETTLED' | 'FAILED'>()
      .notNull()
      .default('PENDING'),
    batchPeriodStart: timestamp('batch_period_start', {
      withTimezone: true,
    }).notNull(),
    batchPeriodEnd: timestamp('batch_period_end', {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

// ────────────────────────────────────────────
// 정산 배치 항목 (Settlement Batch Item)
// ────────────────────────────────────────────
export const settlementBatchItem = pgTable(
  'settlement_batch_item',
  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    batchId: varchar('batch_id', { length: 26 })
      .notNull()
      .references(() => settlementBatch.id),
    bnplTransactionId: varchar('bnpl_transaction_id', { length: 26 })
      .notNull()
      .references(() => bnplTransaction.id),
    amount: numeric('amount', { precision: 19, scale: 4 })
      .$type<number>()
      .notNull(),
    transactionDate: timestamp('transaction_date', {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  }
);

// ────────────────────────────────────────────
// 관계 정의 (Relations)
// ────────────────────────────────────────────

// BNPL 계정 관계
export const bnplAccountRelations = relations(bnplAccount, ({ many }) => ({
  activationEvents: many(bnplActivationEvent),
  transactions: many(bnplTransaction),
  settlementBatches: many(settlementBatch),
}));

// BNPL 활성화 이벤트 관계
export const bnplActivationEventRelations = relations(
  bnplActivationEvent,
  ({ one }) => ({
    paymentMethod: one(paymentMethod, {
      fields: [bnplActivationEvent.paymentMethodId],
      references: [paymentMethod.id],
    }),
    bnplAccount: one(bnplAccount, {
      fields: [bnplActivationEvent.bnplAccountId],
      references: [bnplAccount.id],
    }),
  }),
);

// BNPL 거래 관계
export const bnplTransactionRelations = relations(
  bnplTransaction,
  ({ one, many }) => ({
    bnplAccount: one(bnplAccount, {
      fields: [bnplTransaction.bnplAccountId],
      references: [bnplAccount.id],
    }),
    settlementBatchItems: many(settlementBatchItem),
  }),
);

// 정산 배치 관계
export const settlementBatchRelations = relations(
  settlementBatch,
  ({ one, many }) => ({
    bnplAccount: one(bnplAccount, {
      fields: [settlementBatch.bnplAccountId],
      references: [bnplAccount.id],
    }),
    items: many(settlementBatchItem),
  }),
);

// 정산 배치 항목 관계
export const settlementBatchItemRelations = relations(
  settlementBatchItem,
  ({ one }) => ({
    settlementBatch: one(settlementBatch, {
      fields: [settlementBatchItem.batchId],
      references: [settlementBatch.id],
    }),
    bnplTransaction: one(bnplTransaction, {
      fields: [settlementBatchItem.bnplTransactionId],
      references: [bnplTransaction.id],
    }),
  }),
);

// ────────────────────────────────────────────
// Zod 스키마 (nestjs-zod용)
// ────────────────────────────────────────────

// BNPL 계정 스키마
export const BnplAccountSchema = z.object({
  id: z.string(),
  userId: z.number().int(),
  paymentMethodId: z.string(),
  creditLimit: z.number().positive().max(10000000),
  approvedLimit: z.number().positive().max(10000000),
  currentBalance: z.number(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'OVERDUE', 'SUSPENDED']),
  billingCycleDay: z.number().int().min(1).max(31),
  termsUrl: z.string().url().nullable().optional(),
  version: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date()
});

// BNPL 계정 생성 스키마
export const CreateBnplAccountSchema = z.object({
  userId: z.number().int().positive(),
  methodType: z.literal('BNPL'),
  methodName: z.string().min(1).max(64),
  institutionCode: z.string().min(1),
  billingCycleDay: z.number().int().min(1).max(31),
  isDefault: z.boolean().optional(),
  creditLimit: z.number().positive().max(10000000).optional(),
  approvedLimit: z.number().positive().max(10000000).optional(),
  termsUrl: z.string().url().optional(),
  phone: z.string().regex(/^01[0-9]{8,9}$/).optional()
});

// BNPL 거래 스키마
export const BnplTransactionSchema = z.object({
  id: z.string(),
  bnplAccountId: z.string(),
  invoiceId: z.number().int().positive(),
  transactionType: z.enum(['DEBIT', 'CREDIT']),
  status: z.enum(['AUTHORIZED', 'CAPTURED', 'VOIDED']),
  amount: z.number().positive(),
  createdAt: z.date()
});

// BNPL 거래 생성 스키마
export const CreateBnplTransactionSchema = z.object({
  bnplAccountId: z.string(),
  invoiceId: z.number().int().positive(),
  transactionType: z.enum(['DEBIT', 'CREDIT']),
  status: z.enum(['AUTHORIZED', 'CAPTURED', 'VOIDED']),
  amount: z.number().positive()
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
  updatedAt: z.date()
});

// 정산 배치 생성 스키마
export const CreateSettlementBatchSchema = z.object({
  bnplAccountId: z.string(),
  batchNumber: z.string().regex(/^\d{4}-\d{2}$/), // YYYY-MM 형식
  totalAmount: z.number().min(0),
  dueDate: z.date(),
  status: z.enum(['PENDING', 'PROCESSING', 'SETTLED', 'FAILED']).optional(),
  batchPeriodStart: z.date(),
  batchPeriodEnd: z.date()
});

// 정산 배치 업데이트 스키마
export const UpdateSettlementBatchSchema = z.object({
  status: z.enum(['PENDING', 'PROCESSING', 'SETTLED', 'FAILED']).optional(),
  totalAmount: z.number().min(0).optional(),
  dueDate: z.date().optional(),
  batchPeriodStart: z.date().optional(),
  batchPeriodEnd: z.date().optional()
});

// BNPL 활성화 이벤트 스키마
export const BnplActivationEventSchema = z.object({
  id: z.string(),
  paymentMethodId: z.string(),
  bnplAccountId: z.string(),
  eventType: z.enum(['ACTIVATED', 'DEACTIVATED']),
  actor: z.enum(['USER', 'ADMIN', 'SYSTEM']),
  createdAt: z.date()
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