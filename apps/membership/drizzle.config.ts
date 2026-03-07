import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import { join } from 'path';
config({ path: join(__dirname, '.env'), override: true });

export default defineConfig({
  schema: [
    'apps/membership/src/**/schema.ts',
    'libs/events/src/outbox/outbox.schema.ts',
    'libs/events/src/tracking/tracking.schema.ts',
  ],
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['public', 'event'],
  verbose: true, // 상세한 로그 출력
  strict: true,
  // auth 스키마는 npm run migrate:auth로 관리 (README 권장 방법)
  // drizzle-kit은 membership 서비스의 테이블만 관리
});
