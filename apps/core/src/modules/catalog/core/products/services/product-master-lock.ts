import { asc, inArray } from 'drizzle-orm';
import { AnyTx } from '@app/db';
import { productMasters } from '../../../schema/catalog.schema';

/** 공개 상태·전체 스냅샷을 쓰는 경로는 버전 행보다 상품을 먼저 잠가 이벤트 순서를 맞춘다. */
export async function lockProductMasters(tx: Pick<AnyTx, 'select'>, masterIds: string[]): Promise<void> {
  const ids = [...new Set(masterIds)].sort();

  if (ids.length === 0) {
    return;
  }

  await tx
    .select({ id: productMasters.id })
    .from(productMasters)
    .where(inArray(productMasters.id, ids))
    .orderBy(asc(productMasters.id))
    .for('update');
}
