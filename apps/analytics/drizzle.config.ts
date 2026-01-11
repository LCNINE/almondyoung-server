import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { join } from 'path';

config({ path: join(__dirname, '.env'), override: true });

export default defineConfig({
  schema: './apps/analytics/src/schema.ts',
  out: './apps/analytics/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
  strict: true,
});
