import { defineConfig } from 'drizzle-kit';
import { join } from 'path';
import { config } from 'dotenv';

config({ path: join(__dirname, '../../.env.test') });

export default defineConfig({
    schema: 'apps/wms/database/schemas/wms-schema.ts',
    out: 'apps/wms/database/drizzle',
    dialect: 'postgresql',
    dbCredentials: {
        url: process.env.DATABASE_URL ?? '',
    },
    verbose: true,
});
