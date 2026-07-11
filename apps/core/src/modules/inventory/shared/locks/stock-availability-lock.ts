import { sql } from 'drizzle-orm';
import { DbTx } from '../../schema/inventory.schema';

export interface StockPair {
  skuId: string;
  warehouseId: string;
}

/**
 * (sku, warehouse) advisory 락 후보를 결정적 순서로 정렬 + 중복 제거.
 * 멀티키 트랜잭션이 항상 같은 순서로 락을 획득하게 해 교차 데드락을 막는다.
 */
export function sortAndDedupeStockPairs(pairs: StockPair[]): StockPair[] {
  const seen = new Set<string>();
  const unique: StockPair[] = [];
  for (const p of pairs) {
    const key = `${p.skuId}:${p.warehouseId}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return unique.sort((a, b) =>
    a.skuId === b.skuId ? a.warehouseId.localeCompare(b.warehouseId) : a.skuId.localeCompare(b.skuId),
  );
}

/**
 * 단일 (sku, warehouse) advisory xact 락. 트랜잭션 종료 시 자동 해제.
 * 선례: product-sellable-quantity.service.ts 의 hashtext 기반 락.
 */
export async function acquireStockAvailabilityLock(trx: DbTx, skuId: string, warehouseId: string): Promise<void> {
  await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${skuId}:${warehouseId}`}))`);
}

/** 멀티키: 정렬/dedup 후 순차 획득 (교차 데드락 방지). */
export async function acquireStockAvailabilityLocks(trx: DbTx, pairs: StockPair[]): Promise<void> {
  for (const p of sortAndDedupeStockPairs(pairs)) {
    await acquireStockAvailabilityLock(trx, p.skuId, p.warehouseId);
  }
}
