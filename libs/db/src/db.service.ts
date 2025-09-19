// src/common/db/db.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';

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
    const client = postgres(this.config.connectionString, {
      // 필요하면 여기서 에러 핸들러도 설정 가능
      onnotice: (notice) => {
        // notice 로그 처리
        console.warn('Postgres notice:', notice.message);
      },
    });

    const rawDb = drizzle(client, { schema: this.schema });

    // 여기서 proxy로 감싸서 공통 error 처리
    this._db = new Proxy(rawDb, {
      get(target, prop) {
        const orig = (target as any)[prop];
        if (typeof orig !== 'function') return orig;

        return async (...args: any[]) => {
          try {
            return await orig.apply(target, args);
          } catch (err: any) {
            if (err.message?.includes('value too long')) {
              throw new Error('DB 에러: 컬럼 길이 제한 초과');
            }
            if (err.message?.includes('null value in column')) {
              throw new Error('DB 에러: 필수 컬럼 값이 누락되었습니다');
            }
            throw err;
          }
        };
      },
    });
  }

  get db(): PostgresJsDatabase<TSchema> {
    return this._db;
  }
}
