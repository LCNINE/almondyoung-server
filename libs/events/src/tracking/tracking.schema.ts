import { eventSchema } from '../outbox/outbox.schema';
import { pgTable, varchar, text, timestamp, index } from 'drizzle-orm/pg-core';

export const event_resource_links = eventSchema.table('event_resource_links', {
  id: varchar('id', { length: 36 }).primaryKey(),         // UUID v7
  eventId: varchar('event_id', { length: 26 }).notNull(), // envelope.messageId (ULID)
  chainId: varchar('chain_id', { length: 36 }).notNull(), // UUID v7
  eventType: varchar('event_type', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 100 }).notNull(),
  resourceId: varchar('resource_id', { length: 100 }).notNull(),
  direction: varchar('direction', { length: 10 }).notNull(), // 'CAUSE' | 'EFFECT'
  action: varchar('action', { length: 50 }),                // EFFECT만: 'CREATED', 'UPDATED', 'DELETED'
  description: text('description'),
  serviceName: varchar('service_name', { length: 100 }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  chainIdx: index('erl_chain_idx').on(t.chainId),
  resourceIdx: index('erl_resource_idx').on(t.resourceType, t.resourceId),
  eventIdx: index('erl_event_idx').on(t.eventId),
}));

export const trackingSchema = { event_resource_links };
