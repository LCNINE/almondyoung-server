import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config({ path: '.env' });
console.log('DATABASE_URL', process.env.DATABASE_URL);

export default defineConfig({
  schema: './src/database/auth.schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
  },
  schemaFilter: ['auth'],
  verbose: true,
  strict: true,
});
