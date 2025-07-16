import { relations } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  timestamp,
  foreignKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { paymentMethod } from '../shared/schemas/payment-method.schema';

// PG Integration 모듈에서 사용할 수 있도록 re-export
export { paymentMethod };

// ────────────────────────────────────────────
// 카드 결제 수단 (Card Method)
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
    cardType: varchar('card_type', { length: 32 }), // CREDIT, DEBIT, PREPAID 등
    issuerName: varchar('issuer_name', { length: 64 }), // 카드사명
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
// 관계 정의 (Relations) - 카드 결제수단만
// ────────────────────────────────────────────

// 정방향 관계: paymentMethod -> 카드
export const paymentMethodRelations = relations(paymentMethod, ({ one }) => ({
  card: one(cardMethod, {
    fields: [paymentMethod.id],
    references: [cardMethod.id],
  }),
}));

// 역방향 관계: 카드 -> paymentMethod
export const cardMethodRelations = relations(cardMethod, ({ one }) => ({
  paymentMethod: one(paymentMethod, {
    fields: [cardMethod.id],
    references: [paymentMethod.id],
  }),
}));