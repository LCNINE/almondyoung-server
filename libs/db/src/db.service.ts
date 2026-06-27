// src/common/db/db.service.ts
import { Injectable, Inject, OnApplicationShutdown, OnModuleDestroy } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DrizzleSchema, TxFor } from './types';

export const DB_CONNECTION = 'DB_CONNECTION';
export const DB_SCHEMA = 'DB_SCHEMA';

// 기존의 host, port 등 개별 설정 대신 connectionString 하나로 관리
export interface DbConfig {
  connectionString: string; // Neon에서 제공하는 DATABASE_URL
}

@Injectable()
export class DbService<TSchema extends DrizzleSchema = Record<string, never>>
  implements OnModuleDestroy, OnApplicationShutdown
{
  private _db: PostgresJsDatabase<TSchema>;
  private _client: postgres.Sql | null = null;

  constructor(
    @Inject(DB_CONNECTION) private readonly config: DbConfig,
    @Inject(DB_SCHEMA) private readonly schema: TSchema,
  ) {
    this.initializeConnection();
  }

  private initializeConnection(): void {
    // postgres.js는 Connection String을 직접 받을 수 있습니다.
    const client = postgres(this.config.connectionString);
    this._client = client;
    this._db = drizzle(client, { schema: this.schema });
  }

  get db(): PostgresJsDatabase<TSchema> {
    return this._db;
  }

  /**
   * Single transaction runner. If `tx` is provided, runs `fn` inside it
   * (propagation); otherwise opens a new transaction. Replaces the per-class
   * `inTx` helper. The callback's tx type is derived from this DbService's
   * schema (`TxFor<TSchema>`); cross-BC seam services inject a wider schema.
   */
  async run<T>(fn: (tx: TxFor<TSchema>) => Promise<T>, tx?: TxFor<TSchema>): Promise<T> {
    return tx ? fn(tx) : this._db.transaction(fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.close();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private async close(): Promise<void> {
    try {
      await (this._client as any)?.end?.();
    } catch {
      // ignore
    } finally {
      this._client = null;
    }
  }
}
