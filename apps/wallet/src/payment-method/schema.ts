import { relations } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  timestamp,
  numeric,
  foreignKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { paymentMethod } from '../shared/schemas/payment-method.schema';

// ────────────────────────────────────────────
// 3️⃣ Card Method (카드)
// ────────────────────────────────────────────
export const cardMethod = pgTable(
  'card_method',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    methodType: text('method_type').notNull().default('CARD'),
    pgToken: varchar('pg_token', { length: 128 }).notNull(),
    billingKey: varchar('billing_key', { length: 128 }).notNull(),
    maskedCardNumber: varchar('masked_card_number', { length: 32 }).notNull(),
    lastFourDigits: varchar('last_four_digits', { length: 4 }),
    cardBrand: varchar('card_brand', { length: 32 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_card_billing_key_unique').on(table.billingKey),
    foreignKey({
      columns: [table.id, table.methodType],
      foreignColumns: [paymentMethod.id, paymentMethod.methodType],
      name: 'fk_card_method_payment_method',
    }).onDelete('cascade'),
  ],
);

// ────────────────────────────────────────────
// 4️⃣ Bank Account Method (계좌)
// ────────────────────────────────────────────
export const bankAccountMethod = pgTable(
  'bank_account_method',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    methodType: text('method_type').notNull().default('BANK_ACCOUNT'),
    pgToken: varchar('pg_token', { length: 128 }).notNull(),
    billingKey: varchar('billing_key', { length: 128 }).notNull(),
    maskedAccountNumber: varchar('masked_account_number', {
      length: 32,
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_bank_billing_key_unique').on(table.billingKey),
    foreignKey({
      columns: [table.id, table.methodType],
      foreignColumns: [paymentMethod.id, paymentMethod.methodType],
      name: 'fk_bank_account_method_payment_method',
    }).onDelete('cascade'),
  ],
);

// 지갑 기능 제거됨 - prepaidWalletMethod 테이블 삭제

// ────────────────────────────────────────────
// 7️⃣ Reward Point Method (포인트)
// ────────────────────────────────────────────
export const rewardPointMethod = pgTable(
  'reward_point_method',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    methodType: text('method_type').notNull().default('REWARD_POINT'),
    balanceSnapshot: numeric('balance_snapshot', {
      precision: 18,
      scale: 2,
    }).$type<number>(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.id, table.methodType],
      foreignColumns: [paymentMethod.id, paymentMethod.methodType],
      name: 'fk_reward_point_method_payment_method',
    }).onDelete('cascade'),
  ],
);

// ────────────────────────────────────────────
//  Relations (관계 정의)
// ────────────────────────────────────────────

// ➡️ 정방향 관계: paymentMethod -> 하위 테이블들
export const paymentMethodRelations = relations(paymentMethod, ({ one }) => ({
  card: one(cardMethod, {
    fields: [paymentMethod.id],
    references: [cardMethod.id],
  }),
  bankAccount: one(bankAccountMethod, {
    fields: [paymentMethod.id],
    references: [bankAccountMethod.id],
  }),
  rewardPoint: one(rewardPointMethod, {
    fields: [paymentMethod.id],
    references: [rewardPointMethod.id],
  }),
}));

// ⬅️ 역방향 관계: 하위 테이블들 -> paymentMethod

export const cardMethodRelations = relations(cardMethod, ({ one }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [cardMethod.id],
    references: [paymentMethod.id],
  }),
}));

export const bankAccountMethodRelations = relations(
  bankAccountMethod,
  ({ one }) => ({
    paymentMethod: one(paymentMethod, {
      fields: [bankAccountMethod.id],
      references: [paymentMethod.id],
    }),
  }),
);

// 지갑 관련 Relations 제거됨

export const rewardPointMethodRelations = relations(
  rewardPointMethod,
  ({ one }) => ({
    paymentMethod: one(paymentMethod, {
      fields: [rewardPointMethod.id],
      references: [paymentMethod.id],
    }),
  }),
);

// Payment-Method 모듈은 카드, 계좌, 포인트 결제수단만 관리
