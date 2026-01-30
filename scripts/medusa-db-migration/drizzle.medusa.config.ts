import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  schema: './src/medusa.schema.ts',
  out: './drizzle/medusa',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.MEDUSA_DATABASE_URL || '',
  },
});
