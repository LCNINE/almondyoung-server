import { pgTable, varchar, timestamp, text } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { ulid } from 'ulid';
import { z } from 'zod';
import * as schema from '../../shared/schemas/schema';

/**
 * 정산 처리 이벤트 테이블
 * 이벤트 소싱 패턴에 따라 모든 정산 처리 과정을 이벤트로 기록
 */
export const settlementProcessEvent = pgTable('settlement_process_event', {
  id: varchar('id', { length: 26 }).primaryKey().$defaultFn(ulid),

  batchId: varchar('batch_id', { length: 26 })
    .notNull()
    .references(() => schema.settlementBatch.id),

  batchItemId: varchar('batch_item_id', { length: 26 }).references(
    () => schema.settlementBatchItem.id,
  ),

  eventType: varchar('event_type', { length: 50 })
    .$type<
      | 'BATCH_STARTED'
      | 'ITEM_PROCESSING'
      | 'ITEM_SUCCESS'
      | 'ITEM_FAILED'
      | 'BATCH_COMPLETED'
      | 'BATCH_FAILED'
    >()
    .notNull(),

  status: varchar('status', { length: 50 })
    .$type<'PROCESSING' | 'SUCCESS' | 'FAILED'>()
    .notNull(),

  paymentEventId: varchar('payment_event_id', { length: 26 }),

  errorMessage: text('error_message'),

  metadata: text('metadata'), // JSON 형태로 추가 정보 저장

  actor: varchar('actor', { length: 255 })
    .$type<'SCHEDULER' | 'ADMIN' | 'SYSTEM'>()
    .notNull()
    .default('SCHEDULER'),

  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

/**
 * 정산 처리 이벤트 관계
 */
export const settlementProcessEventRelations = relations(
  settlementProcessEvent,
  ({ one }) => ({
    settlementBatch: one(schema.settlementBatch, {
      fields: [settlementProcessEvent.batchId],
      references: [schema.settlementBatch.id],
    }),
    settlementBatchItem: one(schema.settlementBatchItem, {
      fields: [settlementProcessEvent.batchItemId],
      references: [schema.settlementBatchItem.id],
    }),
  }),
);

/**
 * 정산 처리 이벤트 Zod 스키마
 */
export const SettlementProcessEventSchema = z.object({
  id: z.string().length(26),
  batchId: z.string().length(26),
  batchItemId: z.string().length(26).optional(),
  eventType: z.enum([
    'BATCH_STARTED',
    'ITEM_PROCESSING',
    'ITEM_SUCCESS',
    'ITEM_FAILED',
    'BATCH_COMPLETED',
    'BATCH_FAILED',
  ]),
  status: z.enum(['PROCESSING', 'SUCCESS', 'FAILED']),
  paymentEventId: z.string().length(26).optional(),
  errorMessage: z.string().optional(),
  metadata: z.string().optional(),
  actor: z.enum(['SCHEDULER', 'ADMIN', 'SYSTEM']),
  createdAt: z.date(),
});

export const CreateSettlementProcessEventSchema =
  SettlementProcessEventSchema.omit({
    id: true,
    createdAt: true,
  });

export type SettlementProcessEvent = z.infer<
  typeof SettlementProcessEventSchema
>;
export type CreateSettlementProcessEvent = z.infer<
  typeof CreateSettlementProcessEventSchema
>;
