// src/common/db/db.service.ts
import { Injectable, Inject, OnApplicationShutdown, Optional } from '@nestjs/common';
import { drizzle, PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as postgres from 'postgres';
import { DrizzleSchema, TxFor } from './types';

// nest build(CJS)에서는 네임스페이스가 곧 호출 가능한 함수지만, tsx 같은 ESM 로더는
// ESM 빌드를 골라 함수가 default 아래에 온다. 어느 쪽이든 호출 가능한 쪽을 집는다.
const postgresFn: typeof postgres =
  typeof postgres === 'function' ? postgres : ((postgres as { default?: typeof postgres }).default as typeof postgres);

export const DB_CONNECTION = 'DB_CONNECTION';
export const DB_SCHEMA = 'DB_SCHEMA';
export const DB_ROUTER = 'DB_ROUTER';

// 기존의 host, port 등 개별 설정 대신 connectionString 하나로 관리
export interface DbConfig {
  connectionString: string; // Neon에서 제공하는 DATABASE_URL
}

/**
 * DB 를 여럿 두고 맥락으로 하나를 고르는 앱(core 의 테넌트별 DB)만 준다. 없으면 접속 주소 하나에 풀 하나다.
 * 풀마다 붙을 DB 이름만 정한다 — 호스트·계정은 `connectionString` 의 것을 쓴다.
 * 세션 단위 `SET`(search_path 등)으로 갈라 쓰지 않는다: postgres.js 는 연결을 파이프라이닝하므로 한 연결에 건 설정이
 * 다른 요청의 쿼리로 샌다. 그래서 DB 마다 풀이 따로다.
 */
export interface DbRouter {
  /** 풀 키 → 그 풀이 붙을 DB 이름. */
  readonly databases: ReadonlyMap<string, string>;
  /** 지금 맥락이 고르는 풀 키. 고를 수 없으면 던진다 — 아무 풀로나 떨어지지 않는다. */
  current(): string;
}

/** 라우팅 풀 하나의 크기. 연결 예산(테넌트당 10)이 이 값으로 잡혀 있다. */
const ROUTED_POOL_MAX = 10;

/** 접속 주소의 DB 이름만 바꾼다. */
export function connectionStringFor(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

interface Pool<TSchema extends DrizzleSchema> {
  client: postgres.Sql;
  db: PostgresJsDatabase<TSchema>;
}

@Injectable()
export class DbService<TSchema extends DrizzleSchema = Record<string, never>> implements OnApplicationShutdown {
  private _db: PostgresJsDatabase<TSchema>;
  private _client: postgres.Sql | null = null;
  /** 라우터가 있을 때의 풀들(키 → 풀). 이때 `_db`·`_client` 는 쓰지 않는다. */
  private routed: Map<string, Pool<TSchema>> | null = null;

  constructor(
    @Inject(DB_CONNECTION) private readonly config: DbConfig,
    @Inject(DB_SCHEMA) private readonly schema: TSchema,
    @Optional() @Inject(DB_ROUTER) private readonly router: DbRouter | null = null,
  ) {
    this.initializeConnection();
  }

  private initializeConnection(): void {
    if (this.router) {
      // postgres.js 는 첫 쿼리 때 접속하므로 풀을 미리 만들어도 연결은 열리지 않는다.
      this.routed = new Map(
        [...this.router.databases].map(([key, database]) => {
          const client = postgresFn(connectionStringFor(this.config.connectionString, database), {
            max: ROUTED_POOL_MAX,
          });
          return [key, { client, db: drizzle(client, { schema: this.schema }) }];
        }),
      );
      return;
    }
    // postgres.js는 Connection String을 직접 받을 수 있습니다.
    const client = postgresFn(this.config.connectionString);
    this._client = client;
    this._db = drizzle(client, { schema: this.schema });
  }

  /** 라우터가 있으면 지금 맥락의 풀. 맥락이 없거나 풀이 없는 키면 던진다. */
  get db(): PostgresJsDatabase<TSchema> {
    if (!this.router) return this._db;
    const key = this.router.current();
    const pool = this.routed?.get(key);
    if (!pool) throw new Error(`DbService: 라우터가 고른 키 «${key}» 의 풀이 없다`);
    return pool.db;
  }

  /**
   * Single transaction runner. If `tx` is provided, runs `fn` inside it
   * (propagation); otherwise opens a new transaction. Replaces the per-class
   * `inTx` helper. The callback's tx type is derived from this DbService's
   * schema (`TxFor<TSchema>`); cross-BC seam services inject a wider schema.
   */
  async run<T>(fn: (tx: TxFor<TSchema>) => Promise<T>, tx?: TxFor<TSchema>): Promise<T> {
    return tx ? fn(tx) : this.db.transaction(fn);
  }

  // 풀은 여기서만 닫는다. Nest 종료 순서는 destroy 훅, dispose()(HTTP 와 마이크로서비스 컨슈머 정지),
  // shutdown 훅이다. onModuleDestroy 에서 닫으면 컨슈머가 멈추기 전에 처리 중이던 메시지가
  // "connection ended" 로 실패해 재시도·DLQ 로 갔다 (#1073).
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private async close(): Promise<void> {
    const clients = [this._client, ...[...(this.routed?.values() ?? [])].map((p) => p.client)];
    await Promise.all(
      clients.map(async (client) => {
        try {
          await client?.end();
        } catch {
          // ignore
        }
      }),
    );
    this._client = null;
    this.routed = null;
  }
}
