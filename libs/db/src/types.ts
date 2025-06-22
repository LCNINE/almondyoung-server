import { Table } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type DrizzleTable = Table<any>;

export type DrizzleSchema = Record<string, DrizzleTable>;

export type TypedDatabase<TSchema extends DrizzleSchema> = PostgresJsDatabase<TSchema>;

export type TableNames<TSchema extends DrizzleSchema> = keyof TSchema & string;

export type SchemaTable<
  TSchema extends DrizzleSchema,
  TTableName extends TableNames<TSchema>,
> = TSchema[TTableName];

export interface DbEnvironmentConfig {
  DB_HOST: string;
  DB_PORT: string;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
}

export function createDbConfigFromEnv(env: DbEnvironmentConfig) {
  return {
    host: env.DB_HOST,
    port: parseInt(env.DB_PORT, 10),
    database: env.DB_NAME,
    username: env.DB_USER,
    password: env.DB_PASSWORD,
  };
} 