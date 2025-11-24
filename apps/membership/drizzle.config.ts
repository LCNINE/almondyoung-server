import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '.env'), override: true });

export default defineConfig({
  schema: [
    './src/**/schema.ts',
    '../../libs/authorization/src/database/auth.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL || '',
  },
  verbose: true, // 상세한 로그 출력
  strict: true,
  schemaFilter: ['public', 'auth'], // auth 스키마도 포함
});
