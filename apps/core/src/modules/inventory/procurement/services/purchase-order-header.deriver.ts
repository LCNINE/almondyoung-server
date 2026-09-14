import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../schema/inventory.schema';
import { deriveHeaderStatus, isDerivationFrozen, PurchaseOrderStatus } from './purchase-order-status.rules';

/**
 * 헤더 재파생(스펙 §5.2). 라인을 바꾸는 모든 조작이 끝에서 부른다 — 파생 경로가 하나라
 * 결함 ㄱ·ㄴ·ㄷ 이 설 자리가 없다.
 *
 * 🔴 **호출자가 발주 행을 이미 `FOR UPDATE` 로 잠갔어야 한다.** 여기서 다시 잠그지 않는다 —
 * 잠금 취득 지점을 한 곳(각 Manager 메서드의 첫 문장)으로 유지하기 위해서다.
 * 트랜잭션을 열지 않는다(`DbService` 미주입). `tx` 는 필수·마지막 인자다(PR-A 커널과 동일한 트랜잭션 전파 규약).
 */
@Injectable()
export class PurchaseOrderHeaderDeriver {
  async refresh(poId: string, tx: DbTx): Promise<PurchaseOrderStatus> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1);
    if (!header) throw new Error(`purchase order vanished under lock: ${poId}`);
    if (isDerivationFrozen(header.status)) return header.status;

    const lines = await tx
      .select({
        status: wmsTables.purchaseOrderLines.status,
        orderedQty: wmsTables.purchaseOrderLines.orderedQty,
        receivedQty: wmsTables.purchaseOrderLines.receivedQty,
        closedAt: wmsTables.purchaseOrderLines.closedAt,
      })
      .from(wmsTables.purchaseOrderLines)
      .where(eq(wmsTables.purchaseOrderLines.poId, poId));
    const next = deriveHeaderStatus(lines);
    if (next !== header.status) {
      await tx
        .update(wmsTables.purchaseOrders)
        .set({ status: next, updatedAt: new Date() })
        .where(eq(wmsTables.purchaseOrders.id, poId));
    }
    return next;
  }
}
