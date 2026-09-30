import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { lockSkuCapacities } from '../picking/allocation/allocation.locks';
import { SessionStartAllocation } from '../picking/allocation/allocation.types';
import { ReconcilePlan, reconcileAllocation } from '../picking/allocation/reconcile-allocation';
import { BatchInventorySessionRow, BatchInventorySessionService } from './batch-inventory-session.service';

/**
 * 배정 변경의 실행부(스펙 §5 원칙). 규칙은 `reconcileAllocation` 이 정하고, 여기서는 잠금 아래에서 적용만 한다.
 * 호출자(오케스트레이터)가 구성요소와 작업 항목을 먼저 잡는다 — 이 클래스는 그 뒤의 «세션 → 보관 → 재고» 를 맡는다.
 */
@Injectable()
export class BoxAllocationManager {
  constructor(
    private readonly sessions: BatchInventorySessionService,
    private readonly controlledStock: BatchControlledStockGuard,
  ) {}

  /**
   * 배치의 열린 세션(active·recovery_required)과 그 보관 행을 잠근다. 발송과 같은 «세션 → 보관» 순서다 — 합류는
   * 이 뒤에 가용 잠금을 잡으므로, 세션보다 가용 잠금을 먼저 잡으면 발송(세션 → 가용 잠금)과 교착한다.
   */
  async lockOpenSession(batchId: string, trx: DbTx): Promise<BatchInventorySessionRow | null> {
    const [session] = await trx
      .select()
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, batchId),
          inArray(wmsTables.batchInventorySessions.status, ['active', 'recovery_required']),
        ),
      )
      .limit(1)
      .for('update');
    if (!session) return null;
    await trx
      .select({ id: wmsTables.batchInventorySessionBalances.id })
      .from(wmsTables.batchInventorySessionBalances)
      .where(eq(wmsTables.batchInventorySessionBalances.sessionId, session.id))
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id))
      .for('update');
    return session;
  }

  /** 합류(목표 0 → 줄 수량)의 계획. 쓰지 않는다 — 호출자가 다른 사유(송장)와 묶어 판정한 뒤 applyJoin 한다(스펙 §7-5). */
  async planJoin(
    input: { warehouseId: string; workItemId: string; lines: Array<{ id: string; skuId: string; qty: number }> },
    trx: DbTx,
  ): Promise<ReconcilePlan> {
    const { capacities, inboundPendingBySku } = await lockSkuCapacities(
      trx,
      this.controlledStock,
      input.warehouseId,
      input.lines.map((line) => line.skuId),
    );
    return reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: line.qty })),
      allocations: [],
      atSource: new Map(),
      capacities,
      inboundPendingBySku,
    });
  }

  /**
   * 합류 계획을 적용한다 — 배정 행을 넣고 실행 중 세션에 인계(HAND_IN)한다. `handIn` 은 배정이 이 배치의 것이고
   * 수량이 양수라고 믿는다: 계획이 이 배치에 방금 만든 작업 항목 하나를 목표로 `planJoin` 에서 왔고,
   * `allocateLines` 는 0 수량 draft 를 만들지 않는다.
   */
  async applyJoin(
    input: {
      session: BatchInventorySessionRow;
      batchId: string;
      actorId: string;
      operationId: string;
      plan: ReconcilePlan;
      lines: Array<{ id: string; skuId: string }>;
    },
    trx: DbTx,
  ): Promise<void> {
    const { plan } = input;
    if (
      plan.shortages.length ||
      plan.handBacks.length ||
      plan.cartSurplus.length ||
      plan.excess.length ||
      !plan.handIns.length ||
      plan.handIns.some((draft) => draft.qty <= 0)
    ) {
      throw new Error('applyJoin: a join plan must be a non-empty pure hand-in');
    }
    const inserted = await trx.insert(wmsTables.pickingSourceAllocations).values(plan.handIns).returning();
    const skuByLine = new Map(input.lines.map((line) => [line.id, line.skuId]));
    const allocations: SessionStartAllocation[] = inserted.map((row) => ({
      id: row.id,
      // holds because every inserted row came from plan.handIns, built with the joining work item id.
      workItemId: row.workItemId!,
      shipmentLineId: row.shipmentLineId,
      // holds because plan.handIns came from input.lines (planJoin targets), which built skuByLine.
      skuId: skuByLine.get(row.shipmentLineId)!,
      sourceLocationId: row.sourceLocationId,
      quantity: row.qty,
      sourceStockVersion: row.sourceStockVersion,
    }));
    await this.sessions.handIn(
      {
        sessionId: input.session.id,
        batchId: input.batchId,
        actorId: input.actorId,
        operationId: input.operationId,
        allocations,
      },
      trx,
    );
  }
}

/** 닫힌 배치(파생 `completed`·`canceled`)와 세션이 `active` 가 아닌 시작된 배치 — 합류도 추가도 받지 않는다. */
export function notJoinable(batchId: string, why: string): ConflictException {
  return new ConflictException({
    code: 'BATCH_NOT_JOINABLE',
    error: 'BATCH_NOT_JOINABLE',
    message: `Batch ${batchId} is not joinable: ${why}`,
  });
}
