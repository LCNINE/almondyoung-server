import { eq, sql } from 'drizzle-orm';
import { ConflictError } from '@app/shared';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

/** 관리자가 버린 요청 키로 온 쓰기 — 반영하지 않았다. */
export class OperationAbandonedError extends ConflictError {
  constructor() {
    super('관리자가 버린 작업이에요. 필요하면 새로 해 주세요.');
  }
  getErrorCode(): string {
    return 'OPERATION_ABANDONED';
  }
}

/**
 * 요청 키 하나를 트랜잭션이 끝날 때까지 잡는다. 같은 키로 쓰는 요청과 그 키를 버리는 관리자 정리가 여기서 줄을 선다 —
 * 먼저 끝난 쪽만 이긴다.
 */
export async function lockOperationKey(trx: DbTx, key: string): Promise<void> {
  await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`operation-key:${key}`}, 0))`);
}

/** 키를 잡고, 버린 키면 반영하지 않고 거절한다. 멱등 기록을 남기는 쓰기 경로의 맨 앞에서 부른다. */
export async function assertOperationKeyUsable(trx: DbTx, key: string): Promise<void> {
  await lockOperationKey(trx, key);
  const [abandoned] = await trx
    .select({ key: wmsTables.abandonedOperationKeys.operationKey })
    .from(wmsTables.abandonedOperationKeys)
    .where(eq(wmsTables.abandonedOperationKeys.operationKey, key))
    .limit(1);
  if (abandoned) throw new OperationAbandonedError();
}
