import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/pim/.env', override: true });

export default {
  schema: './apps/pim/src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
} satisfies Config;
