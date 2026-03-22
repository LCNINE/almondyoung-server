import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '.env'), override: true });

export default defineConfig({
  schema: [
    './apps/analytics/src/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
    'libs/authorization/src/database/auth.schema.ts',
  ],
  out: './apps/analytics/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  schemaFilter: ['public', 'event', 'auth'],
  verbose: true,
  strict: true,
});
