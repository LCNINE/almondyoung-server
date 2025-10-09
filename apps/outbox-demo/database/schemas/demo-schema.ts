import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import * as outboxSchema from './outbox.schema';
import * as testSchema from './test.schema';

export const schema = {
  ...outboxSchema,
  ...testSchema,
};

export type DbSchema = typeof schema;
export type Database = PostgresJsDatabase<DbSchema>;
export type DbTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export function createDatabase(connectionString: string): Database {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}
