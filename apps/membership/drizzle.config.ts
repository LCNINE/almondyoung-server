import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/**/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/membership_dev',
  },
  verbose: true, // 상세한 로그 출력
  strict: true,
});