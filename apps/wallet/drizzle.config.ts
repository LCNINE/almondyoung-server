import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '.env'), override: true });

export default defineConfig({
  schema: [
    'apps/wallet/src/schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
  ],
  schemaFilter: ['public', 'event'],
  out: 'apps/wallet/drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  verbose: true,
  strict: true,
});
