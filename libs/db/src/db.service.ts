import { Injectable, Inject } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const DB_CONNECTION = 'DB_CONNECTION';
export const DB_SCHEMA = 'DB_SCHEMA';

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
}

@Injectable()
export class DbService<TSchema extends Record<string, unknown> = Record<string, never>> {
  private _db: PostgresJsDatabase<TSchema>;

  constructor(
    @Inject(DB_CONNECTION) private readonly config: DbConfig,
    @Inject(DB_SCHEMA) private readonly schema: TSchema,
  ) {
    this.initializeConnection();
  }

  private initializeConnection(): void {
    const client = postgres({
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      username: this.config.username,
      password: this.config.password,
    });

    this._db = drizzle(client, { schema: this.schema });
  }

  get db(): PostgresJsDatabase<TSchema> {
    return this._db;
  }
}
