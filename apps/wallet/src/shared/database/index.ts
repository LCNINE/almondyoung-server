// shared/database/index.ts
// DB 연결 및 스키마 익스포트
import { DbService } from '@app/db';
export * from './schema';
import * as schema from './schema';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

// 1. 전체 DB 인스턴스에 대한 타입을 export 합니다.
export type WalletDb = PostgresJsDatabase<typeof schema>;

// 2. 기존의 트랜잭션 타입입니다.
export type WalletTx = Parameters<
  DbService<typeof schema>['db']['transaction']
>[0] extends (tx: infer T) => any
  ? T
  : never;

// 3. ✨ 해결: 위 두 타입을 모두 포함하는 새로운 Executor 타입을 만듭니다.
export type WalletExecutor = WalletDb | WalletTx;
export async function runInTransaction<TResult>(
  db: DbService<typeof schema>,
  callback: (tx: WalletTx) => Promise<TResult>,
): Promise<TResult> {
  // this.db.db.transaction을 직접 호출하되, 콜백의 타입을 WalletTx로 명시적으로 보장합니다.
  return db.db.transaction(callback);
}
