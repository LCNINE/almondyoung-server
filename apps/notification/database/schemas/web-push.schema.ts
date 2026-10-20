import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const webPushSubscriptions = pgTable(
  'web_push_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    endpoint: text('endpoint').notNull().unique(),
    keys: jsonb('keys').$type<{ auth: string; p256dh: string }>().notNull(),
    active: boolean('active').notNull().default(true),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('web_push_subscription_user').on(t.userId)],
);

export const webPushDeliveries = pgTable(
  'web_push_deliveries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    key: text('key').notNull(),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => webPushSubscriptions.id),
    status: text('status').notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('web_push_delivery_key').on(t.key, t.subscriptionId)],
);

export const webPushTables = { webPushSubscriptions, webPushDeliveries };
