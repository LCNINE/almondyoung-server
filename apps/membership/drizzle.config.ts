import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '.env') });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: [
    'apps/membership/src/**/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
    'libs/authorization/src/database/auth.schema.ts',
  ],
  out: './apps/membership/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event', 'auth'],
  migrations: { prefix: 'supabase' },
});
