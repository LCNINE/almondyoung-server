import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/ugc-service/.env', override: true });

export default {
  schema: './apps/ugc-service/src/db/schema.ts',
  out: './apps/ugc-service/src/db',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
} satisfies Config;
