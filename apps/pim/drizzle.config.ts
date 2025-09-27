import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/pim/.env' });

export default {
  schema: './src/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
} satisfies Config;
