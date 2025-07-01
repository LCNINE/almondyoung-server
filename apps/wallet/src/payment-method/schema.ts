// modules/payment-method/payment-method.schema.ts
import {
  pgTable,
  bigint,
  varchar,
  timestamp,
  bigserial,
} from 'drizzle-orm/pg-core';
import { ulid } from 'ulid';

//
// PaymentMethod (공통 결제수단)
//
export const paymentMethod = pgTable('payment_method', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  methodType: varchar('method_type', { length: 32 }).notNull(), // CARD | BANK_ACCOUNT | PREPAID_WALLET | REWARD_POINT
  methodName: varchar('method_name', { length: 64 }).notNull(),
  isDefault: varchar('is_default', { length: 1 }).notNull(), // 'Y' | 'N'
  status: varchar('status', { length: 16 }).notNull(), // ACTIVE | INACTIVE | DELETED
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),

  // TODO: 향후 감사 추적 강화를 위한 필드들
  // deletedAt: timestamp('deleted_at', { withTimezone: true }),
  // deletedBy: varchar('deleted_by', { length: 26 }), // 삭제한 사용자/시스템 ID
  // deleteReason: varchar('delete_reason', { length: 100 }), // USER_REQUEST | EXPIRED | SYSTEM | FRAUD
});

//
// CardMethod
//
export const cardMethod = pgTable('card_method', {
  id: varchar('id', { length: 26 }).primaryKey(), // 결제수단 ID (FK)
  cardCompanyId: bigint('card_company_id', { mode: 'number' }).notNull(),
  pgToken: varchar('pg_token', { length: 128 }).notNull(),
  billingKey: varchar('billing_key', { length: 128 }).notNull(),
  maskedCardNumber: varchar('masked_card_number', { length: 32 }).notNull(),
  expiryMonthYear: varchar('expiry_month_year', { length: 6 }).notNull(), // YYYYMM
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),

  // TODO: 향후 더 정확한 카드 식별을 위한 필드들
  // cardFingerprint: varchar('card_fingerprint', { length: 64 }), // 카드번호+유효기간 해시
  // lastFourDigits: varchar('last_four_digits', { length: 4 }), // 마지막 4자리 (검색용)
});

//
// BankAccountMethod
//
export const bankAccountMethod = pgTable('bank_account_method', {
  id: varchar('id', { length: 26 }).primaryKey(), // 결제수단 ID (FK)
  bankId: bigint('bank_id', { mode: 'number' }).notNull(),
  pgToken: varchar('pg_token', { length: 128 }).notNull(),
  billingKey: varchar('billing_key', { length: 128 }).notNull(),
  maskedAccountNumber: varchar('masked_account_number', {
    length: 64,
  }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

//
// PrepaidWalletMethod
//
export const prepaidWalletMethod = pgTable('prepaid_wallet_method', {
  id: varchar('id', { length: 26 }).primaryKey(), // 결제수단 ID (FK)
  walletId: bigint('wallet_id', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

//
// RewardPointMethod
//
export const rewardPointMethod = pgTable('reward_point_method', {
  id: varchar('id', { length: 26 }).primaryKey(), // 결제수단 ID (FK)
  pointId: bigint('point_id', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

//
// Bank (은행 마스터)
//
export const bank = pgTable('bank', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  code: varchar('code', { length: 16 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(), // ACTIVE | INACTIVE
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

//
// CardCompany (카드사 마스터)
//
export const cardCompany = pgTable('card_company', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  code: varchar('code', { length: 16 }).notNull(),
  name: varchar('name', { length: 64 }).notNull(),
  status: varchar('status', { length: 16 }).notNull(), // ACTIVE | INACTIVE
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});
