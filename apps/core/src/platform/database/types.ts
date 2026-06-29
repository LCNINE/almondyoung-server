import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { TxFor } from '@app/db';
import { MergedSchema } from './merged-schema';

/** 통합 앱의 Drizzle DB 인스턴스 타입 */
export type AppDb = PostgresJsDatabase<MergedSchema>;

/** 트랜잭션 컨텍스트 타입 — WMS의 DbTx 패턴을 통합 스키마 기준으로 재정의 */
export type DbTx = TxFor<MergedSchema>;
