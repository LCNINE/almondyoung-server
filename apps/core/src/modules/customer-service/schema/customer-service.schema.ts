import { type InferInsertModel, type InferSelectModel, relations, sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { v7 as uuidv7 } from 'uuid';

export type CsCaseStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type CsCasePriority = 'low' | 'normal' | 'high' | 'urgent';

export const csCases = pgTable(
  'cs_cases',
  {
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),
    status: varchar('status', { length: 32 }).$type<CsCaseStatus>().notNull().default('open'),
    priority: varchar('priority', { length: 32 }).$type<CsCasePriority>().notNull().default('normal'),
    reasonCode: varchar('reason_code', { length: 96 }),
    subject: varchar('subject', { length: 255 }).notNull(),
    description: text('description'),
    customerId: uuid('customer_id'),
    customerName: varchar('customer_name', { length: 255 }),
    customerEmail: varchar('customer_email', { length: 255 }),
    customerPhone: varchar('customer_phone', { length: 64 }),
    assignedTo: uuid('assigned_to'),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdBy: uuid('created_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_cs_cases_status').on(t.status),
    index('idx_cs_cases_reason_code').on(t.reasonCode),
    index('idx_cs_cases_customer_id').on(t.customerId),
    index('idx_cs_cases_created_at').on(t.createdAt),
  ],
);

export const csCasesRelations = relations(csCases, () => ({}));

export const customerServiceSchema = {
  csCases,
  csCasesRelations,
};

export type CustomerServiceSchema = typeof customerServiceSchema;
export type CsCase = InferSelectModel<typeof csCases>;
export type NewCsCase = InferInsertModel<typeof csCases>;
