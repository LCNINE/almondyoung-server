import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';
import { outboxSchema } from 'libs/events/src/outbox/outbox.schema';

export const testRecords = pgTable('test_records', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type TestRecord = typeof testRecords.$inferSelect;
export type NewTestRecord = typeof testRecords.$inferInsert;


export const outboxDemoSchema = {
  testRecords,
  ...outboxSchema,
};

export type OutboxDemoSchema = typeof outboxDemoSchema;