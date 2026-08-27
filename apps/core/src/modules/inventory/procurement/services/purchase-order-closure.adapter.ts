import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../schema/inventory.schema';
import { PurchaseOrderClosurePort } from '../../shared/ports/purchase-order-closure.port';
import { canDeriveReceived } from './purchase-order-closure.rules';

/**
 * 3층 파생(`plan → PO`)의 소유자. 입고는 사실만 넘기고 판단은 여기서 한다.
 *
 * 🔴 잠금 순서 불변식: PO 행 → 라인 행. 이 메서드는 PO 를 먼저 잡고 라인을 읽는다.
 * 호출자(입고 트랜잭션)는 이 시점에 계획·아이템만 건드린 상태이며, 라인 실행 경로가
 * 기존 아이템 행을 잠그지 않으므로(`addInboundPlanItems` 는 insert 전용) 대기
 * 사이클이 닫히지 않는다. 스펙 §9 참조.
 *
 * DbService 를 주입받지 않는다 — 항상 호출자의 트랜잭션 안에서만 돈다.
 */
@Injectable()
export class PurchaseOrderClosureAdapter implements PurchaseOrderClosurePort {
  async onPlanClosed(poId: string, tx: DbTx): Promise<void> {
    const [header] = await tx
      .select({ status: wmsTables.purchaseOrders.status })
      .from(wmsTables.purchaseOrders)
      .where(eq(wmsTables.purchaseOrders.id, poId))
      .limit(1)
      .for('update');
    if (!header) return;

    const [requested] = await tx
      .select({ skuId: wmsTables.purchaseOrderLines.skuId })
      .from(wmsTables.purchaseOrderLines)
      .where(
        and(eq(wmsTables.purchaseOrderLines.poId, poId), eq(wmsTables.purchaseOrderLines.status, 'requested')),
      )
      .limit(1);

    if (!canDeriveReceived({ current: header.status, hasRequestedLine: !!requested })) return;

    await tx
      .update(wmsTables.purchaseOrders)
      .set({ status: 'received', updatedAt: new Date() })
      .where(eq(wmsTables.purchaseOrders.id, poId));
  }
}
