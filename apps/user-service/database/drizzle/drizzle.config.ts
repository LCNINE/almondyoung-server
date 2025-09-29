import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

config({ path: join(__dirname, '../../.env'), override: true });

export default defineConfig({
  out: './apps/user-service/database/drizzle',
  schema: './apps/user-service/database/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  verbose: true,
});
