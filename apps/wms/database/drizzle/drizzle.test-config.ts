import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: 'apps/wms/database/schemas/wms-schema.ts',
  out: 'apps/wms/database/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://test_user:test_password@localhost:5432/wms_test',
  },
});