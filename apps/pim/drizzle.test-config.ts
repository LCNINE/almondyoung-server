import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: 'apps/pim/src/schema.ts',
  out: 'apps/pim/drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://test_user:test_password@localhost:5432/pim_test',
  },
});


