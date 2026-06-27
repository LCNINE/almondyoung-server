import { Relations, Table, View } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export type DrizzleTable = Table<any>;
export type DrizzleRelations = Relations<any>;
export type DrizzleView = View<any>;

export type DrizzleSchema = Record<string, DrizzleTable | DrizzleRelations | DrizzleView>;

export type TypedDatabase<TSchema extends DrizzleSchema> = PostgresJsDatabase<TSchema>;

/**
 * Canonical transaction-handle type for a given schema.
 * The single sanctioned way to derive a per-BC tx type:
 *   export type WmsTx = TxFor<typeof wmsSchema>;
 */
export type TxFor<TSchema extends DrizzleSchema> = Parameters<
  Parameters<PostgresJsDatabase<TSchema>['transaction']>[0]
>[0];

/**
 * Wide transaction type for cross-BC seam services that must accept a
 * transaction opened under a different BC's schema view. This is the only
 * sanctioned `any` surface for transaction propagation — every per-BC
 * `TxFor<S>` is assignable to it. Seam services narrow it back with a single
 * `tx as TxFor<TheirSchema>` at the point they run their own work.
 */
export type AnyTx = { select: any; insert: any; update: any; delete: any; execute: any };

export type TableNames<TSchema extends DrizzleSchema> = keyof TSchema & string;

export type SchemaTable<TSchema extends DrizzleSchema, TTableName extends TableNames<TSchema>> = TSchema[TTableName];

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
