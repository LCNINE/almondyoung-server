import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/almondyoung-server/.env' });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: [
    './apps/almondyoung-server/src/modules/catalog/schema/catalog.schema.ts',
    './apps/almondyoung-server/src/modules/inventory/schema/inventory.schema.ts',
    './libs/events/src/outbox/outbox.schema.ts',
    './libs/events/src/tracking/tracking.schema.ts',
  ],
  out: './apps/almondyoung-server/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event'],
  verbose: true,
  strict: true,
});
