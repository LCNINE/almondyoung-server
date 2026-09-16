import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/ai/.env' });

export default defineConfig({
  schema: [
    './apps/ai/src/db/schema.ts',
    'libs/authorization/src/database/auth.schema.ts',
    'libs/cron-once/src/cron-runs.schema.ts',
  ],
  out: './apps/ai/src/db',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'auth'],
  migrations: { prefix: 'supabase' },
});
