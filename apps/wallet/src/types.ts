import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WalletSchema } from './schema';

export type DbTx = PostgresJsDatabase<WalletSchema>;
export type DbTransaction = DbTx;
