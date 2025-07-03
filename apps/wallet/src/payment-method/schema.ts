import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  boolean,
  bigint,
  timestamp,
  numeric,
  unique,
  foreignKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ulid } from 'ulid';

// 예시용 wallets 테이블 (실제 프로젝트에서는 import 하세요)
const wallets = pgTable('wallets', {
  id: varchar('id', { length: 26 }).primaryKey(),
});

// ────────────────────────────────────────────
// 2️⃣ Payment Method (최상위 결제 수단)
// ────────────────────────────────────────────
export const paymentMethod = pgTable(
  'payment_method',

  {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    methodType: text('method_type')
      .$type<
        'CARD' | 'BANK_ACCOUNT' | 'PREPAID_WALLET' | 'BNPL' | 'REWARD_POINT'
      >()
      .notNull(),
    methodName: varchar('method_name', { length: 64 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    // 💡 institutionCode 컬럼 유지
    institutionCode: varchar('institution_code', { length: 32 }).notNull(),
    status: text('status').$type<'ACTIVE' | 'INACTIVE' | 'DELETED'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex('idx_user_default_unique')
      .on(table.userId)
      .where(sql`${table.isDefault} = true`),
    unique('uq_payment_method_id_type').on(table.id, table.methodType),
  ],
);

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

// ────────────────────────────────────────────
// 5️⃣ Prepaid Wallet Method (선불 지갑)
// ────────────────────────────────────────────
export const prepaidWalletMethod = pgTable(
  'prepaid_wallet_method',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    methodType: text('method_type').notNull().default('PREPAID_WALLET'),
    walletId: varchar('wallet_id', { length: 26 })
      .notNull()
      .references(() => wallets.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.id, table.methodType],
      foreignColumns: [paymentMethod.id, paymentMethod.methodType],
      name: 'fk_prepaid_wallet_method_payment_method',
    }).onDelete('cascade'),
  ],
);

// ────────────────────────────────────────────
// 6️⃣ BNPL Method (후불 결제)
// ────────────────────────────────────────────
export const bnplMethod = pgTable(
  'bnpl_method',
  {
    id: varchar('id', { length: 26 }).primaryKey(),
    methodType: text('method_type').notNull().default('BNPL'),
    creditLimit: numeric('credit_limit', {
      precision: 18,
      scale: 2,
    }).$type<number>(),
    approvedLimit: numeric('approved_limit', {
      precision: 18,
      scale: 2,
    }).$type<number>(),
    termsUrl: varchar('terms_url', { length: 256 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.id, table.methodType],
      foreignColumns: [paymentMethod.id, paymentMethod.methodType],
      name: 'fk_bnpl_method_payment_method',
    }).onDelete('cascade'),
  ],
);

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
  prepaidWallet: one(prepaidWalletMethod, {
    fields: [paymentMethod.id],
    references: [prepaidWalletMethod.id],
  }),
  bnpl: one(bnplMethod, {
    fields: [paymentMethod.id],
    references: [bnplMethod.id],
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

export const prepaidWalletMethodRelations = relations(
  prepaidWalletMethod,
  ({ one }) => ({
    paymentMethod: one(paymentMethod, {
      fields: [prepaidWalletMethod.id],
      references: [paymentMethod.id],
    }),
  }),
);

export const bnplMethodRelations = relations(bnplMethod, ({ one }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [bnplMethod.id],
    references: [paymentMethod.id],
  }),
}));

export const rewardPointMethodRelations = relations(
  rewardPointMethod,
  ({ one }) => ({
    paymentMethod: one(paymentMethod, {
      fields: [rewardPointMethod.id],
      references: [paymentMethod.id],
    }),
  }),
);
