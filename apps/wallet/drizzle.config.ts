import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '.env') });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: [
    'apps/wallet/src/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
    'libs/authorization/src/database/auth.schema.ts',
  ],
  schemaFilter: ['public', 'event', 'auth'],
  out: 'apps/wallet/drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  migrations: { prefix: 'supabase' },
});
