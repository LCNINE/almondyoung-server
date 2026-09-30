import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { boxHasPickedItems } from '../picking/allocation/allocation.errors';
import { lockSkuCapacities } from '../picking/allocation/allocation.locks';
import { SessionStartAllocation } from '../picking/allocation/allocation.types';
import { ReconcilePlan, atSourceKey, reconcileAllocation } from '../picking/allocation/reconcile-allocation';
import { BatchInventorySessionRow, BatchInventorySessionService } from './batch-inventory-session.service';

/** 줄에 귀속된 보관 — 집은 몫(`ReconcileAllocationRow.attributedQty`). AT_SOURCE·BULK_CART 는 줄을 모른다. */
const LINE_ATTRIBUTED_CUSTODY: readonly string[] = [
  'WORKER',
  'TOTE',
  'SORTING',
  'PACKING',
  'PACKED',
  'RETURN_PENDING',
  'SETTLED',
];

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
  /**
   * 집기 전 이탈(목표 → 0). 호출자가 구성요소·작업 항목·세션을 잠갔다. 집은 몫이나 카트에 실렸을 수 있는 몫이 있으면
   * 아무것도 바꾸지 않고 BOX_HAS_PICKED_ITEMS(PR 3 이 되돌림으로 연다). 아니면 배정마다 HAND_BACK 하고 배정을 줄인다 —
   * 반납된 재고는 세션 통제가 풀려 그 자리에서 일반 가용이 된다. 반납과 배정 감소는 같은 트랜잭션이다(복구 규칙:
   * 배정마다 Σ HAND_IN − Σ HAND_BACK = qty).
   */
  async withdrawUnpicked(
    input: {
      session: BatchInventorySessionRow;
      shipmentId: string;
      workItemId: string;
      lines: Array<{ id: string; skuId: string }>;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<{ handedBackQty: number }> {
    const lineIds = new Set(input.lines.map((line) => line.id));
    const rows = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        skuId: wmsTables.shipmentLines.skuId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        locationCode: wmsTables.locations.code,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .innerJoin(wmsTables.locations, eq(wmsTables.locations.id, wmsTables.pickingSourceAllocations.sourceLocationId))
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId),
          gt(wmsTables.pickingSourceAllocations.qty, 0),
        ),
      );
    // 보관 행은 lockOpenSession 이 이미 잠갔다.
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      );
    const attributed = new Map<string, number>();
    const atSource = new Map<string, number>();
    for (const balance of balances) {
      if (!balance.sourceLocationId) continue;
      if (balance.custodyType === 'AT_SOURCE') {
        const key = atSourceKey(balance.skuId, balance.sourceLocationId);
        atSource.set(key, (atSource.get(key) ?? 0) + balance.qty);
      } else if (
        balance.shipmentLineId &&
        lineIds.has(balance.shipmentLineId) &&
        LINE_ATTRIBUTED_CUSTODY.includes(balance.custodyType)
      ) {
        const key = `${balance.shipmentLineId}|${balance.sourceLocationId}`;
        attributed.set(key, (attributed.get(key) ?? 0) + balance.qty);
      }
    }
    const plan = reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: 0 })),
      allocations: rows.map((row) => ({
        ...row,
        // I3 이 지켜졌다면 귀속 ≤ 배정이다. 넘으면 reconcileAllocation 이 입력 오류로 던진다 — 조용히 자르지 않는다.
        attributedQty: attributed.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0,
      })),
      atSource,
      capacities: [],
    });
    if (plan.excess.length || plan.cartSurplus.length) {
      throw boxHasPickedItems(input.shipmentId, [...plan.excess, ...plan.cartSurplus]);
    }
    for (const back of plan.handBacks) {
      await this.sessions.handBack(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId: input.workItemId,
          allocationId: back.allocationId,
          shipmentLineId: back.shipmentLineId,
          skuId: back.skuId,
          sourceLocationId: back.sourceLocationId,
          quantity: back.qty,
        },
        trx,
      );
      const [reduced] = await trx
        .update(wmsTables.pickingSourceAllocations)
        .set({ qty: sql`${wmsTables.pickingSourceAllocations.qty} - ${back.qty}` })
        .where(
          and(
            eq(wmsTables.pickingSourceAllocations.id, back.allocationId),
            gte(wmsTables.pickingSourceAllocations.qty, back.qty),
          ),
        )
        .returning({ id: wmsTables.pickingSourceAllocations.id });
      if (!reduced) {
        throw new ConflictException({
          code: 'PICKING_ALLOCATION_STALE',
          error: 'PICKING_ALLOCATION_STALE',
          message: `Allocation ${back.allocationId} changed`,
        });
      }
    }
    return { handedBackQty: plan.handBacks.reduce((total, back) => total + back.qty, 0) };
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
