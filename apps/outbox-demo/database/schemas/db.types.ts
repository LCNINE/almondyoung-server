import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { outboxDemoSchema } from './schema';

export type DbSchema = typeof outboxDemoSchema;
export type Database = PostgresJsDatabase<DbSchema>;
export type DbTx = Parameters<Parameters<Database['transaction']>[0]>[0];
