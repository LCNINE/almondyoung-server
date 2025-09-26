import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './database/schemas/notification-schema.ts',
  out: './database/drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: 'postgresql://neondb_owner:npg_27JqkIlicZHD@ep-long-pine-a10ch769-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require',
  },
  verbose: true,
  strict: true,
});
