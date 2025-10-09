import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';

export const test_records = pgTable('test_records', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  description: varchar('description', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull().default('ACTIVE'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type TestRecord = typeof test_records.$inferSelect;
export type NewTestRecord = typeof test_records.$inferInsert;
