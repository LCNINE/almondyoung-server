import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { wmsTables, DbTx } from '../../schema/inventory.schema';

export interface ReceivedPlanItemInput {
  planId: string;
  skuId: string;
  receivedQty: number;
  toLocationId: string;
}

/**
 * 출발 창고 입고분을 최종 목적지로 옮길 `draft` 이동 지시서를 자동으로 세운다.
 *
 * 해외 발주는 예전에 destination plan 을 함께 만들어 "부천에도 뭔가 온다"는 표시를
 * 남겼다. 그 계획을 폐지하면서 표시가 사라졌는데, 그 자리를 이동 지시서 초안이
 * 대신한다. 초안이 없으면 파이프라인 ②(출발 창고 대기) 구간에서 MD 가 재고 0 /
 * 입고예정 0 을 보고 중복 발주한다.
 *
 * 트랜잭션을 여기서 열지 않는다 — 호출자(입고 수령)가 이미 연 트랜잭션 안에서
 * 원장·계획 갱신과 원자적으로 묶여야 한다. 그래서 `tx` 는 선택이 아니라 필수다.
 */
@Injectable()
export class TransferDraftService {
  /**
   * 출발 창고 입고분에 대한 draft 이동 지시서를 만들거나 수량을 누적한다.
   * 출발↔목적지 창고 쌍당 draft 는 하나만 유지한다 — 수령 회차마다 지시서가 늘면
   * 물류팀이 배 한 척에 여러 지시서를 들고 선적하게 된다.
   */
  async upsertDraftForReceivedPlanItem(input: ReceivedPlanItemInput, tx: DbTx): Promise<void> {
    const [plan] = await tx
      .select({
        warehouseId: wmsTables.inboundPlans.warehouseId,
        destinationWarehouseId: wmsTables.inboundPlans.destinationWarehouseId,
        requiresTransfer: wmsTables.inboundPlans.requiresTransfer,
        planType: wmsTables.inboundPlans.planType,
      })
      .from(wmsTables.inboundPlans)
      .where(eq(wmsTables.inboundPlans.id, input.planId))
      .limit(1);

    if (!plan || !plan.requiresTransfer || plan.planType !== 'source') return;
    // 이동 지시서는 창고 간 문서다. 두 창고가 같으면 ck_transfer_orders_cross_warehouse
    // 가 거부하는데, 그 전에 여기서 걸러 입고 자체를 실패시키지 않는다.
    if (plan.warehouseId === plan.destinationWarehouseId) return;
    if (input.receivedQty <= 0) return;

    // 이미 초안이 있으면 행 락으로 잡아 같은 지시서에 누적되게 한다(회차마다 지시서가
    // 늘어나는 것을 막는 주 방어선). 초안이 아직 하나도 없을 때 두 수령이 정확히 동시에
    // 들어오면 초안이 둘 생길 수 있다 — 수량은 라인 unique 로 보존되고 사람이 선적 전에
    // 합칠 수 있어, 여기서 유니크 제약을 새로 걸지는 않는다.
    const [existing] = await tx
      .select({ id: wmsTables.transferOrders.id })
      .from(wmsTables.transferOrders)
      .where(
        and(
          eq(wmsTables.transferOrders.fromWarehouseId, plan.warehouseId),
          eq(wmsTables.transferOrders.toWarehouseId, plan.destinationWarehouseId),
          eq(wmsTables.transferOrders.status, 'draft'),
        ),
      )
      .for('update')
      .limit(1);

    const orderId = existing?.id ?? (await this.insertDraftOrder(tx, plan.warehouseId, plan.destinationWarehouseId));

    await tx
      .insert(wmsTables.transferOrderLines)
      .values({
        transferOrderId: orderId,
        skuId: input.skuId,
        fromLocationId: input.toLocationId,
        plannedQty: input.receivedQty,
      })
      .onConflictDoUpdate({
        target: [
          wmsTables.transferOrderLines.transferOrderId,
          wmsTables.transferOrderLines.skuId,
          wmsTables.transferOrderLines.fromLocationId,
        ],
        set: {
          plannedQty: sql`${wmsTables.transferOrderLines.plannedQty} + ${input.receivedQty}`,
          updatedAt: new Date(),
        },
      });
  }

  private async insertDraftOrder(tx: DbTx, fromWarehouseId: string, toWarehouseId: string): Promise<string> {
    const [order] = await tx
      .insert(wmsTables.transferOrders)
      .values({
        fromWarehouseId,
        toWarehouseId,
        status: 'draft',
        memo: '입고 자동 생성 초안',
      })
      .returning({ id: wmsTables.transferOrders.id });
    if (!order) throw new Error('transfer_orders insert returned no row');
    return order.id;
  }
}
