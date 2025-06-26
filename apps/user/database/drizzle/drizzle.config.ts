import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

config({ path: join(__dirname, '../../.env') });

export default defineConfig({
  out: './apps/user/database/drizzle',
  schema: './apps/user/database/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
});
