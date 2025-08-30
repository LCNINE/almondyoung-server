// shared/database/index.ts
// DB 연결 및 스키마 익스포트
import { DbService } from '@app/db';
export * from './schema';
import * as schema from './schema';

export type WalletTx = Parameters<
  DbService<typeof schema>['db']['transaction']
>[0] extends (tx: infer T) => any
  ? T
  : never;
