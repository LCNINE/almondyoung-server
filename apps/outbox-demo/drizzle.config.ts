import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'apps/outbox-demo/.env' });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    'apps/outbox-demo/database/schemas/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
  ],
  out: './database/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event'],
  verbose: true,
  strict: true,
});
