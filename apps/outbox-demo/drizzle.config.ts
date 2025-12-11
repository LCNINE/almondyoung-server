import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/outbox-demo/.env', override: true });

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    'apps/outbox-demo/database/schemas/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
  ],
  out: './database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
});
