import { relations, sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  boolean,
  bigint,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { nanoid } from 'nanoid';

// ────────────────────────────────────────────
// 공통 결제 수단 (Shared Payment Method Schema)
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

// 기본 관계만 정의 (각 모듈에서 확장)
export const paymentMethodRelations = relations(paymentMethod, ({ one }) => ({}));