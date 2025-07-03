// modules/payment-method/payment-method.schema.ts
// Updated: removed unsupported onUpdateNow, uses application-level sql`NOW()` instead
import {
  pgTable,
  varchar,
  text,
  bigint,
  timestamp,
  decimal,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ulid } from 'ulid';

const ULID_LENGTH = 26;

/**
 * Wallets (선불지갑)
 */
export const wallets = pgTable('wallets', {
  id: varchar('id', { length: ULID_LENGTH })
    .primaryKey()
    .$defaultFn(() => ulid()),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  walletName: varchar('wallet_name', { length: 64 }).notNull(),
  balance: decimal('balance', { precision: 18, scale: 2 }).notNull(),
  status: text('status').$type<'ACTIVE' | 'INACTIVE' | 'SUSPENDED'>().notNull(),
  lastTransactionAt: timestamp('last_transaction_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),

  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const walletEvents = pgTable('wallet_events', {
  id: varchar('id', { length: ULID_LENGTH })
    .primaryKey()
    .$defaultFn(() => ulid()),
  walletId: varchar('wallet_id', { length: ULID_LENGTH })
    .notNull()
    .references(() => wallets.id),
  type: text('type').$type<'DEPOSIT' | 'WITHDRAWAL' | 'ADJUSTMENT'>().notNull(),
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  eventSourceId: varchar('event_source_id', { length: ULID_LENGTH }).notNull(),
  eventSourceName: varchar('event_source_name', { length: 32 }).notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const walletsRelations = relations(wallets, ({ many }) => ({
  events: many(walletEvents),
}));

export const walletEventsRelations = relations(walletEvents, ({ one }) => ({
  wallet: one(wallets, {
    fields: [walletEvents.walletId],
    references: [wallets.id],
  }),
}));
