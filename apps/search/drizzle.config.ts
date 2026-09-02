import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/search/.env' });

export default defineConfig({
  schema: ['./apps/search/src/db/schema.ts'],
  out: './apps/search/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public'],
  migrations: { prefix: 'supabase' },
});
