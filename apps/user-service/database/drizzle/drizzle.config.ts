import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

config({ path: join(__dirname, '../../.env') });

export default defineConfig({
  out: './apps/user-service/database/drizzle',
  schema: './apps/user-service/database/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: 'postgresql://almond-users-service_owner:npg_PESMZpX6nu5L@ep-jolly-river-a8oplnnc-pooler.eastus2.azure.neon.tech/almond-users-service?sslmode=require',
  },
  verbose: true,
});
