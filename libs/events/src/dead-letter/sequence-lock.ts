import { sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

/** 이 파일이 쓰는 것은 `execute` 하나다 — 트랜잭션 객체와 db 둘 다 받는다. */
type Executor = Pick<PostgresJsDatabase<Record<string, never>>, 'execute'>;

export interface SequenceLockKey {
  consumerGroup: string;
  topic: string;
  sequenceKey: string | null;
  /** 순서 키가 없는 행은 그 행 혼자 한 순서다 — 행 id 로 잠근다 */
  rowId?: number;
}

/**
 * 순서 키별 트랜잭션 advisory lock (스펙 §6.2·§7.4). 실시간 보류 검사와 다시 넣기의 «남은 게 없다» 판정을
 * 직렬화한다 — 겹치면 아무도 깨우지 않는 `held` 가 생긴다. 구분자로 US(0x1f)를 쓰는 것은(Postgres text 는 NUL 을 못 담는다) 그룹·토픽·키가 서로의
 * 접두사가 되어도 같은 해시 입력이 나오지 않게 하기 위해서다.
 */
function lockText(key: SequenceLockKey): string {
  const sequence = key.sequenceKey ?? `row:${key.rowId ?? 'none'}`;
  return `dead-letter\u001f${key.consumerGroup}\u001f${key.topic}\u001f${sequence}`;
}

/** 기다린다 — 실시간 소비가 쓴다 */
export async function lockSequence(executor: Executor, key: SequenceLockKey): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockText(key)}, 0))`);
}

/** 기다리지 않는다 — 다시 넣기가 쓴다. 못 잡으면 false(이미 진행 중) */
export async function tryLockSequence(executor: Executor, key: SequenceLockKey): Promise<boolean> {
  const rows = await executor.execute<{ locked: boolean }>(
    sql`select pg_try_advisory_xact_lock(hashtextextended(${lockText(key)}, 0)) as locked`,
  );
  return rows[0]?.locked === true;
}
