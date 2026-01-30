import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '.env') });

export default defineConfig({
  schema: './src/pim.schema.ts',
  out: './drizzle/pim',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.PIM_SOURCE_DB_URL || '',
  },
});
