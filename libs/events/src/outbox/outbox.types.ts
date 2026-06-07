import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outbox_events } from './outbox.schema';

export type OutboxEvent = typeof outbox_events.$inferSelect;
export type NewOutboxEvent = typeof outbox_events.$inferInsert;

export type DbTx = Pick<PostgresJsDatabase<any>, 'insert'>;

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PUBLISHED' | 'FAILED';

export interface OutboxConfig {
  dispatchIntervalMs?: number; // 기본값: 5000
  batchSize?: number; // 기본값: 100
  maxRetries?: number; // 기본값: 5
  cleanupDays?: number; // 기본값: 7
}

export interface SaveEventParams {
  topic: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: any;
  correlationId?: string;
  causationId?: string;
  metadata?: Record<string, unknown>;
}
