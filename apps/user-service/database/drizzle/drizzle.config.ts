import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

config({ path: './apps/user-service/.env' });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  out: './apps/user-service/database/drizzle',
  schema: [
    './apps/user-service/database/drizzle/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
    'libs/authorization/src/database/auth.schema.ts',
  ],
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event', 'auth'],
  verbose: true,
  strict: true,
});
