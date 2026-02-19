import { integer, pgTable, text, timestamp, varchar } from 'drizzle-orm/pg-core';

export const idempotencyKeys = pgTable('idempotency_keys', {
  id: varchar('id', { length: 255 }).primaryKey(),
  userId: varchar('user_id', { length: 64 }).notNull(),
  requestPath: varchar('request_path', { length: 255 }).notNull(),
  requestHash: varchar('request_hash', { length: 64 }).notNull(),
  responseCode: integer('response_code'),
  responseBody: text('response_body'),
  status: text('status').$type<'PENDING' | 'SUCCESS' | 'FAILED'>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

export type IdempotencyStatus = (typeof idempotencyKeys.$inferSelect)['status'];

export interface IdempotencyKeyRecord {
  id: string;
  userId: string;
  requestPath: string;
  requestHash: string;
  responseCode: number | null;
  responseBody: string | null;
  status: IdempotencyStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface NewIdempotencyKeyRecord {
  id: string;
  userId: string;
  requestPath: string;
  requestHash: string;
  responseCode?: number | null;
  responseBody?: string | null;
  status: IdempotencyStatus;
  createdAt: Date;
  updatedAt?: Date;
  expiresAt: Date;
}

export interface UpdateIdempotencyKeyRecord {
  userId?: string;
  requestPath?: string;
  requestHash?: string;
  responseCode?: number | null;
  responseBody?: string | null;
  status?: IdempotencyStatus;
  createdAt?: Date;
  updatedAt?: Date;
  expiresAt?: Date;
}
