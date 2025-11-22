import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '../../../.env'), override: true });
config({ path: join(__dirname, '../../../.env.dev'), override: true });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: 'apps/file-service/src/database/schema.ts',
  out: 'apps/file-service/src/database/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  verbose: true,
});
