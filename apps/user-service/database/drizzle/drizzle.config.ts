import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

config({ path: join(__dirname, '../../.env') });

console.log('process.env.DATABASE_URL:', process.env.DATABASE_URL);
console.log('ENV file path:', join(__dirname, '../../.env'));

export default defineConfig({
  out: './apps/user-service/database/drizzle',
  schema: './apps/user-service/database/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  // strict: true,
});
