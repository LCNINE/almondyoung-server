import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '../../../../.env') });

export default defineConfig({
    schema: 'apps/notification/database/schemas/notification-schema.ts',
    out: 'apps/notification/database/drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.NOTIFICATION_DATABASE_URL ?? '',
    },
    verbose: true,
});