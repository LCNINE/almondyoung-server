import {
  pgTable,
  varchar,
  bigint,
  decimal,
  timestamp,
  text,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';

import { invoice } from '../invoice/schema';
import { paymentMethod } from '../bnpl/schema';

export const paymentEvents = pgTable('payment_events', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(ulid),

  invoiceId: bigint('invoice_id', { mode: 'number' })
    .notNull()
    .references(() => invoice.id),

  paymentMethodId: varchar('payment_method_id', { length: 26 })
    .notNull()
    .references(() => paymentMethod.id),

  amount: decimal('amount', { precision: 19, scale: 4 })
    .$type<string>()
    .notNull(),

  status: varchar('status', { length: 255 })
    .$type<'REQUESTED' | 'SUCCESS' | 'FAILED' | 'DUPLICATE_ATTEMPT'>()
    .notNull(),

  pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
  pgResponse: text('pg_response'),

  actor: varchar('actor', { length: 255 })
    .$type<'USER' | 'SCHEDULER' | 'ADMIN'>()
    .notNull(),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});


export const refundEvents = pgTable('refund_events', {
  id: varchar('id', { length: 26 })
    .primaryKey()
    .$defaultFn(ulid),

  paymentEventId: varchar('payment_event_id', { length: 26 })
    .notNull()
    .references(() => paymentEvents.id),

  amount: decimal('amount', { precision: 19, scale: 4 })
    .$type<string>()
    .notNull(),

  status: varchar('status', { length: 255 })
    .$type<'REQUESTED' | 'SUCCESS' | 'FAILED'>()
    .notNull(),

  reason: text('reason'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/* ------------------------------------------------------------------
 * 2️⃣ 타입 정의
 *    - DB 스키마 타입 (실제 DB 타입과 일치)
 *    - 비즈니스 로직 타입 (number 사용)
 * ----------------------------------------------------------------*/
const id26 = z.string().length(26);

// DB에서 받는 실제 타입 (decimal은 string)
export const RefundEventDbSchema = z.object({
  id: id26,
  paymentEventId: id26,
  amount: z.string(), // DB decimal은 string
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED']),
  reason: z.string().nullable().optional(),
  createdAt: z.date(),
});

// 비즈니스 로직에서 사용하는 타입 (amount는 number)
export const RefundEventSchema = z.object({
  id: id26,
  paymentEventId: id26,
  amount: z.number().positive(), // 비즈니스 로직에서는 number
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED']),
  reason: z.string().nullable().optional(),
  createdAt: z.date(),
});

export const CreateRefundEventSchema = RefundEventSchema.omit({
  id: true,
  createdAt: true,
});

export type RefundEventDb = z.infer<typeof RefundEventDbSchema>; // DB 타입
export type RefundEvent = z.infer<typeof RefundEventSchema>; // 비즈니스 로직 타입
export type CreateRefundEvent = z.infer<typeof CreateRefundEventSchema>;

/* ------------------------------------------------------------------
 * 3️⃣ Drizzle relations
 * ----------------------------------------------------------------*/
export const refundEventsRelations = relations(refundEvents, ({ one }) => ({
  paymentEvent: one(paymentEvents, {
    fields:     [refundEvents.paymentEventId],
    references: [paymentEvents.id],
  }),
}));


// DB에서 받는 실제 타입 (decimal은 string)
export const PaymentEventDbSchema = z.object({
  id: id26,
  invoiceId: z.number().int().nonnegative(),
  paymentMethodId: id26,
  amount: z.string(), // DB decimal은 string
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED', 'DUPLICATE_ATTEMPT']),
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().nullable().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']),
  createdAt: z.date(),
});

// 비즈니스 로직에서 사용하는 타입 (amount는 number)
export const PaymentEventSchema = z.object({
  id: id26,
  invoiceId: z.number().int().nonnegative(),
  paymentMethodId: id26,
  amount: z.number().positive(), // 비즈니스 로직에서는 number
  status: z.enum(['REQUESTED', 'SUCCESS', 'FAILED', 'DUPLICATE_ATTEMPT']),
  pgTransactionId: z.string().max(255).nullable().optional(),
  pgResponse: z.string().nullable().optional(),
  actor: z.enum(['USER', 'SCHEDULER', 'ADMIN']),
  createdAt: z.date(),
});

export const CreatePaymentEventSchema = PaymentEventSchema.omit({
  id: true,
  createdAt: true,
});

export type PaymentEventDb = z.infer<typeof PaymentEventDbSchema>; // DB 타입
export type PaymentEvent = z.infer<typeof PaymentEventSchema>; // 비즈니스 로직 타입
export type CreatePaymentEvent = z.infer<typeof CreatePaymentEventSchema>;

/* ------------------------------------------------------------------
 * 3️⃣ Drizzle relations
 * ----------------------------------------------------------------*/
export const paymentEventsRelations = relations(paymentEvents, ({ one, many }) => ({
  invoice:       one(invoice,       { fields: [paymentEvents.invoiceId],       references: [invoice.id] }),
  paymentMethod: one(paymentMethod, { fields: [paymentEvents.paymentMethodId], references: [paymentMethod.id] }),
  refunds:       many(refundEvents),
}));

