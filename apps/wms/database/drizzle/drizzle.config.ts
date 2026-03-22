import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '../../.env'), override: true });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
    schema: [
        'apps/wms/database/schemas/wms-schema.ts',
        'libs/events/src/outbox/outbox.schema.ts',
        'libs/events/src/tracking/tracking.schema.ts',
    ],
    out: 'apps/wms/database/drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? '',
    },
    schemaFilter: ['public', 'event'],
    verbose: true,
    strict: true,
});
