import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/**/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: 'postgresql://payms_owner:npg_8KxncIF7qoyH@ep-fancy-bonus-a1iiaieh-pooler.ap-southeast-1.aws.neon.tech/payms?sslmode=require&channel_binding=require',
  },
});
