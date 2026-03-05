import type { Config } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: './apps/pim/.env', override: true });

export default {
  schema: [
    './apps/pim/src/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event'],
} satisfies Config;
