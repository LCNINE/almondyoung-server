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
  integer,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

// 지갑 기능 제거됨

// ────────────────────────────────────────────
// 2️⃣ Payment Method (최상위 결제 수단)
// ────────────────────────────────────────────
export const paymentMethod = pgTable(
  'payment_method',

  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    methodType: text('method_type')
      .$type<'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT'>()
      .notNull(),
    methodName: varchar('method_name', { length: 64 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    // 💡 BNPL 기능 활성화 여부
    isBnpl: boolean('is_bnpl').notNull().default(false),
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
// BNPL Account (BNPL 계정 관리)
// ────────────────────────────────────────────
export const bnplAccount = pgTable(
  'bnpl_account',
  {
    id: varchar('id', { length: 21 })
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    // settlementPaymentMethodId 제거 - BNPL은 자체 완결형 결제수단
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
// BNPL Activation Event (BNPL 활성화 이벤트)
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

// ────────────────────────────────────────────
// BNPL Account Relations
// ────────────────────────────────────────────
export const bnplAccountRelations = relations(bnplAccount, ({ many }) => ({
  activationEvents: many(bnplActivationEvent),
}));

// ────────────────────────────────────────────
// BNPL Activation Event Relations
// ────────────────────────────────────────────
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
