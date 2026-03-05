import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '../../.env'), override: true });

export default defineConfig({
    schema: [
        'apps/notification/database/schemas/notification-schema.ts',
        'libs/events/src/outbox/outbox.schema.ts',
        'libs/events/src/tracking/tracking.schema.ts',
    ],
    out: 'apps/notification/database/drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? '',
    },
    schemaFilter: ['public', 'event'],
    verbose: true,
});