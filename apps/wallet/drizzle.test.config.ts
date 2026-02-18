import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '.env.test'), override: true });

export default defineConfig({
  schema: 'apps/wallet/src/schema.test.ts',
  out: 'apps/wallet/drizzle-test',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.WALLET_TEST_DATABASE_URL ?? '' },
  verbose: true,
  strict: true,
});
