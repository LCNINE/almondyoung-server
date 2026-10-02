import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BOX_CUSTODY_TYPES } from './batch-inventory-session.service';

const A = wmsTables.pickingSourceAllocations;
const B = wmsTables.batchInventorySessionBalances;

export interface WithdrawalRemoval {
  shipmentLineId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  sourceLocationId: string;
  locationCode: string;
  /** 박스(작업자 손·토트·분류·포장·검수)에 든 몫 — 송장 스캔 화면에서 상품을 스캔해 바구니로. */
  boxQty: number;
  /** 토탈피킹 카트에 실린 몫 — 분류대에서 여분을 바구니로(스펙 §8, 정한 것 2). */
  cartQty: number;
}

/**
 * 빼는 박스의 뺄 목록(스펙 §10.5 `withdrawing`). 남은 배정 = 뺄 몫이다 — 집지 않은 몫은 이탈 시작 때 이미 반납됐다.
 * 그중 박스 보관이 덮는 만큼이 박스 몫, 나머지가 카트 몫. 조회 전용.
 */
export async function loadWithdrawalRemovals(trx: DbTx, workItemId: string): Promise<WithdrawalRemoval[]> {
  const rows = await trx
    .select({
      shipmentLineId: A.shipmentLineId,
      skuId: wmsTables.shipmentLines.skuId,
      skuCode: wmsTables.skus.code,
      skuName: wmsTables.skus.name,
      sourceLocationId: A.sourceLocationId,
      locationCode: wmsTables.locations.code,
      qty: A.qty,
      batchId: wmsTables.outboundBatchWorkItems.batchId,
    })
    .from(A)
    .innerJoin(wmsTables.outboundBatchWorkItems, eq(wmsTables.outboundBatchWorkItems.id, A.workItemId))
    .innerJoin(wmsTables.shipmentLines, eq(wmsTables.shipmentLines.id, A.shipmentLineId))
    .innerJoin(wmsTables.skus, eq(wmsTables.skus.id, wmsTables.shipmentLines.skuId))
    .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, A.sourceLocationId))
    .where(and(eq(A.workItemId, workItemId), gt(A.qty, 0)))
    .orderBy(asc(wmsTables.locations.code), asc(wmsTables.skus.name));
  if (!rows.length) return [];
  const [session] = await trx
    .select({ id: wmsTables.batchInventorySessions.id })
    .from(wmsTables.batchInventorySessions)
    .where(
      and(
        eq(wmsTables.batchInventorySessions.batchId, rows[0].batchId),
        inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
      ),
    )
    .limit(1);
  const inBox = new Map<string, number>();
  if (session) {
    const held = await trx
      .select({
        shipmentLineId: B.shipmentLineId,
        sourceLocationId: B.sourceLocationId,
        qty: sql<number>`sum(${B.qty})::int`,
      })
      .from(B)
      .where(
        and(
          eq(B.sessionId, session.id),
          inArray(B.custodyType, [...BOX_CUSTODY_TYPES]),
          inArray(
            B.shipmentLineId,
            rows.map((row) => row.shipmentLineId),
          ),
          gt(B.qty, 0),
        ),
      )
      .groupBy(B.shipmentLineId, B.sourceLocationId);
    for (const row of held) inBox.set(`${row.shipmentLineId}|${row.sourceLocationId}`, Number(row.qty));
  }
  return rows.map((row) => {
    const boxQty = Math.min(row.qty, inBox.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0);
    return {
      shipmentLineId: row.shipmentLineId,
      skuId: row.skuId,
      skuCode: row.skuCode,
      skuName: row.skuName,
      sourceLocationId: row.sourceLocationId,
      locationCode: row.locationCode,
      boxQty,
      cartQty: row.qty - boxQty,
    };
  });
}
