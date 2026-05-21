import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/core/.env' });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: [
    './apps/core/src/modules/catalog/schema/catalog.schema.ts',
    './apps/core/src/modules/inventory/schema/inventory.schema.ts',
    './apps/core/src/modules/library/schema/library.schema.ts',
    './libs/events/src/outbox/outbox.schema.ts',
    './libs/events/src/tracking/tracking.schema.ts',
    './libs/authorization/src/database/auth.schema.ts',
  ],
  out: './apps/core/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event', 'auth'],
  migrations: { prefix: 'supabase' },
});
