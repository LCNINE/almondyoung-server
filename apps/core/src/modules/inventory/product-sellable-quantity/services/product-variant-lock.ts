import type { AnyTx } from '@app/db';
import { sql } from 'drizzle-orm';

/** 정책·매칭 행을 쓰기 전에 재계산과 같은 품목 잠금을 잡는다. 트랜잭션 종료 시 해제된다. */
export async function lockProductVariants(tx: AnyTx, variantIds: string[]): Promise<void> {
  const ids = [...new Set(variantIds.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  for (const variantId of ids) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${variantId}))`);
  }
}
