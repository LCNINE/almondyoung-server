import { drizzle } from 'drizzle-orm/postgres-js';
import { getRequiredEnv } from './env';
import * as pimSchema from '../../drizzle/pim/schema';

export function createPimDb() {
  const url = getRequiredEnv('PIM_SOURCE_DB_URL');
  const db = drizzle(url, { schema: pimSchema });
  return db;
}
