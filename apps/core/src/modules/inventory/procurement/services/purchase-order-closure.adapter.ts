import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../schema/inventory.schema';
import { PurchaseOrderClosurePort } from '../../shared/ports/purchase-order-closure.port';
import { canDeriveReceived } from './purchase-order-closure.rules';

/**
 * 3층 파생(`plan → PO`)의 소유자. 입고는 사실만 넘기고 판단은 여기서 한다.
 *
 * 🔴 잠금 순서 불변식: PO 행 → 라인 행. 이 메서드는 PO 를 먼저 잡고 라인을 읽는다.
 * 호출자(입고 트랜잭션)는 이 시점에 계획·아이템을 건드린 상태다 — 아이템 insert
 * (`addInboundPlanItems`)는 기존 아이템 행은 잠그지 않지만, `inbound_plan_items` 가
 * `inbound_plans` 를 FK 로 참조하므로 그 insert 자체가 FK 검사로 계획 행에 암묵적
 * `FOR KEY SHARE` 를 건다 — 개별 태스크 리뷰에서는 이 FK 암묵 락을 세지 않아 놓쳤고,
 * 최종 전체 리뷰에서 드러났다. 계획 행 잠금이 `FOR UPDATE` 였을 때는 이 `FOR KEY
 * SHARE` 와 충돌해 이 PO 잠금(FOR UPDATE)과 ABBA 사이클을 이뤘다(40P01 → 500). 계획
 * 행을 `FOR NO KEY UPDATE` 로 바꿔 그 간선을 없앴다(`inbound.service.ts` 의
 * `closePlanIfDone`) — 이 어댑터가 PO 행에 거는 `FOR UPDATE` 자체는 그대로다. 스펙
 * §9 참조.
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
