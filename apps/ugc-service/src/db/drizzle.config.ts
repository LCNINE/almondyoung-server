import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/ugc-service/.env' });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: [
    './apps/ugc-service/src/db/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
    'libs/authorization/src/database/auth.schema.ts',
  ],
  out: './apps/ugc-service/src/db',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event', 'auth'],
  migrations: { prefix: 'supabase' },
});
