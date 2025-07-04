import {
    bigint,
    decimal,
    pgTable,
    text,
    timestamp,
    varchar,
  } from 'drizzle-orm/pg-core';
  import { relations } from 'drizzle-orm';
  import { ulid } from 'ulid';
  import { paymentMethod } from '../payment-method/schema';
  import { invoice } from '../invoice/schema';
  
  /**
   * 결제 이벤트 (PaymentEvent)
   * PG사를 통한 실제 결제의 생성, 성공, 실패 상태를 기록하는 핵심 테이블입니다.
   * 모든 결제 시도는 이 테이블에 기록됩니다.
   */
  export const paymentEvents = pgTable('payment_events', {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    
    // 외부 'Invoice' 모듈의 청구서 ID를 참조합니다.
    invoiceId: bigint('invoice_id', { mode: 'number' })
      .notNull()
      .references(() => invoice.id),
    
    // 외부 'PaymentMethod' 모듈의 결제수단 ID를 참조합니다.
    paymentMethodId: varchar('payment_method_id', { length: 26 })
      .notNull()
      .references(() => paymentMethod.id),
  
    amount: decimal('amount', { precision: 19, scale: 4 }).notNull(),
    status: varchar('status', {
      length: 255,
      enum: ['REQUESTED', 'SUCCESS', 'FAILED'],
    }).notNull(),
    
    // PG사로부터 받은 고유 거래 ID
    pgTransactionId: varchar('pg_transaction_id', { length: 255 }),
    pgResponse: text('pg_response'),
    
    actor: varchar('actor', {
      length: 255,
      enum: ['USER', 'SCHEDULER', 'ADMIN'],
    }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  });
  /**
   * 환불 이벤트 (RefundEvent)
   * 성공한 결제(PaymentEvent)에 대한 환불 처리 상태를 기록합니다.
   */
  export const refundEvents = pgTable('refund_events', {
    id: varchar('id', { length: 26 })
      .primaryKey()
      .$defaultFn(() => ulid()),
    
    // 같은 모듈 내의 'payment_events' 테이블을 참조합니다.
    paymentEventId: varchar('payment_event_id', { length: 26 })
      .notNull()
      .references(() => paymentEvents.id),
  
    amount: decimal('amount', { precision: 19, scale: 4 }).notNull(),
    status: varchar('status', {
      length: 255,
      enum: ['REQUESTED', 'SUCCESS', 'FAILED'],
    }).notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  });
  
  // --- 관계 정의 ---
  
  export const paymentEventsRelations = relations(paymentEvents, ({ many, one }) => ({
    // 하나의 결제는 여러 번의 환불(부분 환불)을 가질 수 있습니다.
    refunds: many(refundEvents),
    // 결제수단과의 관계
    paymentMethod: one(paymentMethod, {
      fields: [paymentEvents.paymentMethodId],
      references: [paymentMethod.id],
    }),
    // 청구서와의 관계
    invoice: one(invoice, {
      fields: [paymentEvents.invoiceId],
      references: [invoice.id],
    }),
  }));
  
  export const refundEventsRelations = relations(refundEvents, ({ one }) => ({
    // 하나의 환불은 반드시 하나의 원본 결제를 가집니다.
    paymentEvent: one(paymentEvents, {
      fields: [refundEvents.paymentEventId],
      references: [paymentEvents.id],
    }),
  }));