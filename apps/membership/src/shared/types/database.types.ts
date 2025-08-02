/**
 * Database transaction and query types for better type safety
 */

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../schemas/entities/schema';

/**
 * Type-safe database transaction interface
 */
export type DatabaseTransaction = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

/**
 * Type-safe database instance
 */
export type DatabaseInstance = PostgresJsDatabase<typeof schema>;

/**
 * Query result types for common operations
 */
export type SelectResult<T> = T[];
export type InsertResult = void;
export type UpdateResult = void;
export type DeleteResult = void;

/**
 * Common query builder types
 */
export interface QueryBuilder<T> {
  from: (table: any) => QueryBuilder<T>;
  where: (condition: any) => QueryBuilder<T>;
  orderBy: (column: any) => QueryBuilder<T>;
  limit: (count: number) => QueryBuilder<T>;
  offset: (count: number) => Promise<T[]>;
  innerJoin: (table: any, condition: any) => QueryBuilder<T>;
  leftJoin: (table: any, condition: any) => QueryBuilder<T>;
}

/**
 * Transaction callback type
 */
export type TransactionCallback<T> = (tx: DatabaseTransaction) => Promise<T>;