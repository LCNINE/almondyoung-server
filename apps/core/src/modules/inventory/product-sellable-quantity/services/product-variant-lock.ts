import { eq, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';

/** 정책·매칭 행을 쓰기 전에 재계산과 같은 품목 잠금을 잡는다. 트랜잭션 종료 시 해제된다. */
export async function lockProductVariants(tx: Pick<DbTx, 'execute'>, variantIds: string[]): Promise<void> {
  const ids = [...new Set(variantIds.filter(Boolean))].sort((a, b) => a.localeCompare(b));

  for (const variantId of ids) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${variantId}))`);
  }
}

/** 여러 SKU의 재고를 쓰기 전에 전체 품목 집합을 잠가 SKU 입력 순서에 따른 교착을 막는다. */
export async function lockProductVariantsForSkus(tx: DbTx, skuIds: string[]): Promise<void> {
  const ids = [...new Set(skuIds.filter(Boolean))];

  if (ids.length === 0) return;

  const rows = await tx
    .select({ variantId: wmsTables.productMatchings.variantId })
    .from(wmsTables.productVariantSkuLinks)
    .innerJoin(
      wmsTables.productMatchings,
      eq(wmsTables.productMatchings.id, wmsTables.productVariantSkuLinks.productMatchingId),
    )
    .where(inArray(wmsTables.productVariantSkuLinks.skuId, ids));

  await lockProductVariants(
    tx,
    rows.map((row) => row.variantId),
  );
}
