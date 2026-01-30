import { drizzle } from 'drizzle-orm/postgres-js';
import { getRequiredEnv } from './env';
import * as medusaSchema from '../../drizzle/medusa/schema';

export function createMedusaDb() {
  const url = getRequiredEnv('MEDUSA_DATABASE_URL');
  const db = drizzle(url, { schema: medusaSchema });
  return db;
}
