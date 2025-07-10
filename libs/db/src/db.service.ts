import { Inject, Injectable } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DB_CONNECTION = 'DB_CONNECTION';
export const DB_SCHEMA = 'DB_SCHEMA';

// 기존의 host, port 등 개별 설정 대신 connectionString 하나로 관리
export interface DbConfig {
  connectionString: string; // Neon에서 제공하는 DATABASE_URL
}

@Injectable()
export class DbService<
  TSchema extends Record<string, unknown> = Record<string, never>,
> {
  private _db: PostgresJsDatabase<TSchema>;

  constructor(
    @Inject(DB_CONNECTION) private readonly config: DbConfig,
    @Inject(DB_SCHEMA) private readonly schema: TSchema,
  ) {
    this.initializeConnection();
  }

  private initializeConnection(): void {
    // postgres.js는 Connection String을 직접 받을 수 있습니다.
    const client = postgres(this.config.connectionString);

    this._db = drizzle(client, { schema: this.schema });
  }

  get db(): PostgresJsDatabase<TSchema> {
    return this._db;
  }
}
