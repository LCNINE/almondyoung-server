import {
  pgTable,
  bigint,
  varchar,
  decimal,
  timestamp,
  bigserial,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const INVOICE_STATUS = {
  ISSUED: 'ISSUED',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
  OVERDUE: 'OVERDUE',
} as const;

export type InvoiceStatus = keyof typeof INVOICE_STATUS;

export const invoice = pgTable('invoice', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  userId: bigint('user_id', { mode: 'number' }).notNull(),
  invoiceNumber: varchar('invoice_number', { length: 64 }).notNull(),
  invoiceType: varchar('invoice_type', { length: 32 }).notNull(), // SUBSCRIPTION | PRODUCT
  amount: decimal('amount', { precision: 18, scale: 2 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().$type<InvoiceStatus>(), // ISSUED | PAID | CANCELLED | EXPIRED | OVERDUE
  issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const invoiceEvent = pgTable('invoice_event', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  eventUuid: varchar('event_uuid', { length: 64 }).notNull(),
  invoiceId: bigint('invoice_id', { mode: 'number' })
    .notNull()
    .references(() => invoice.id),
  eventType: varchar('event_type', { length: 16 }).notNull(),
  reason: varchar('reason', { length: 255 }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const invoiceRelations = relations(invoice, ({ many }) => ({
  events: many(invoiceEvent),
}));

export const invoiceEventRelations = relations(invoiceEvent, ({ one }) => ({
  invoice: one(invoice, {
    fields: [invoiceEvent.invoiceId],
    references: [invoice.id],
  }),
}));
