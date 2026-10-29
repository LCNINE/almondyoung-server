import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: './apps/channel-adapter/.env' });

export default defineConfig({
  schema: [
    './apps/channel-adapter/src/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
    'libs/events/src/dead-letter/dead-letter.schema.ts',
    'libs/cron-once/src/cron-runs.schema.ts',
  ],
  out: './apps/channel-adapter/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  schemaFilter: ['public', 'event'],
  migrations: { prefix: 'supabase' },
});
