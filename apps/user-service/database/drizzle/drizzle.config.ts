import { config } from 'dotenv';
import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

const env = process.env.NODE_ENV || 'development';

let envFile: string;

switch (env) {
  case 'development':
    envFile = '.env.dev';
    break;
  case 'production':
    envFile = '.env.prod';
    break;
  case 'test':
    envFile = '.env.test';
    break;
  default:
    envFile = '.env';
}

config({ path: join(__dirname, '../../', envFile), override: true });

export default defineConfig({
  out: './apps/user-service/database/drizzle',
  schema: './apps/user-service/database/drizzle/schema.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  verbose: true,
});
