import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/**/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ||
      'postgresql://neondb_owner:npg_VR7yj1uOfPTs@ep-divine-hill-a1nspuc3-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  },
  verbose: true, // 상세한 로그 출력
  strict: true,
});
