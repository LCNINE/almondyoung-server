import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { lockSkuCapacities } from '../picking/allocation/allocation.locks';
import { SessionStartAllocation } from '../picking/allocation/allocation.types';
import { ReconcilePlan, atSourceKey, reconcileAllocation } from '../picking/allocation/reconcile-allocation';
import {
  BOX_CUSTODY_TYPES,
  BatchInventorySessionRow,
  BatchInventorySessionService,
  ReturnBinRef,
} from './batch-inventory-session.service';
import { LINE_ATTRIBUTED_CUSTODY } from './line-attributed-custody';

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
   * 이탈 시작(목표 → 0)의 반납 단계. 호출자가 구성요소·작업 항목·세션을 잠갔다. 집지 않은 몫(AT_SOURCE 가 덮는 만큼)만
   * HAND_BACK 하고 배정을 같이 줄인다 — 반납된 재고는 그 자리에서 일반 가용이 된다. 집은 몫(excess)과 카트 몫(cartSurplus)은
   * 배정에 남는다: 실물이 되돌림 바구니에 들어갈 때 REMOVE_TO_RETURN_BIN 이 준다(스펙 §8, PR 3 계획이 정함 2·3).
   * 반납과 배정 감소는 같은 트랜잭션이다(복구 규칙: 배정마다 Σ HAND_IN − Σ HAND_BACK − Σ REMOVE_TO_RETURN_BIN = qty).
   */
  async handBackUnpicked(
    input: {
      session: BatchInventorySessionRow;
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
        LINE_ATTRIBUTED_CUSTODY.has(balance.custodyType)
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
      await this.decrementAllocation(back.allocationId, back.qty, trx);
    }
    return { handedBackQty: plan.handBacks.reduce((total, back) => total + back.qty, 0) };
  }

  /**
   * 빼는 박스에서 상품 하나(또는 몇 개)를 되돌림 바구니로(스펙 §8, 세 방식 공통). 호출자가 구성요소·작업 항목·세션을 잠갔다.
   * 배정 행을 로케이션 코드 역순(채운 순서의 반대, PR 2 반납과 같다)으로, 각 행 안에서는 박스 보관 종류 순서
   * (`BOX_CUSTODY_TYPES`)로 뺀다. 모자라면 쓰기 전에 거절한다. PACKED 에서 빼면 검수 수량도 같이 준다(정한 것 6).
   */
  async removeFromBox(
    input: {
      session: BatchInventorySessionRow;
      workItemId: string;
      skuId: string;
      quantity: number;
      returnBin: ReturnBinRef;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<number> {
    const allocations = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
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
          eq(wmsTables.shipmentLines.skuId, input.skuId),
          gt(wmsTables.pickingSourceAllocations.qty, 0),
        ),
      )
      .orderBy(desc(wmsTables.locations.code), desc(wmsTables.pickingSourceAllocations.id));
    // 보관 행은 lockOpenSession 이 잠갔다.
    const custody = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id),
          eq(wmsTables.batchInventorySessionBalances.skuId, input.skuId),
          inArray(wmsTables.batchInventorySessionBalances.custodyType, [...BOX_CUSTODY_TYPES]),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      )
      .orderBy(asc(wmsTables.batchInventorySessionBalances.id));
    const takes: Array<{ allocation: (typeof allocations)[number]; balance: (typeof custody)[number]; qty: number }> = [];
    const taken = new Map<string, number>();
    let remaining = input.quantity;
    for (const allocation of allocations) {
      let room = allocation.qty;
      for (const type of BOX_CUSTODY_TYPES) {
        for (const balance of custody) {
          if (remaining === 0 || room === 0) break;
          if (
            balance.custodyType !== type ||
            balance.shipmentLineId !== allocation.shipmentLineId ||
            balance.sourceLocationId !== allocation.sourceLocationId
          ) {
            continue;
          }
          const qty = Math.min(remaining, room, balance.qty - (taken.get(balance.id) ?? 0));
          if (qty <= 0) continue;
          takes.push({ allocation, balance, qty });
          taken.set(balance.id, (taken.get(balance.id) ?? 0) + qty);
          remaining -= qty;
          room -= qty;
        }
      }
    }
    if (remaining > 0) {
      throw new ConflictException({
        code: 'REMOVAL_NOT_PENDING',
        message: `Only ${input.quantity - remaining} of SKU ${input.skuId} can be removed from work item ${input.workItemId}`,
      });
    }
    for (const take of takes) {
      await this.sessions.removeToReturnBin(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId: input.workItemId,
          allocationId: take.allocation.allocationId,
          shipmentLineId: take.allocation.shipmentLineId,
          skuId: input.skuId,
          sourceLocationId: take.allocation.sourceLocationId,
          quantity: take.qty,
          from: {
            custodyType: take.balance.custodyType,
            custodyRef: take.balance.custodyRef,
            shipmentLineId: take.balance.shipmentLineId,
          },
          returnBin: input.returnBin,
        },
        trx,
      );
      await this.decrementAllocation(take.allocation.allocationId, take.qty, trx);
      if (take.balance.custodyType === 'PACKED') {
        const [line] = await trx
          .update(wmsTables.shipmentLines)
          .set({
            inspectedQty: sql`${wmsTables.shipmentLines.inspectedQty} - ${take.qty}`,
            lineVersion: sql`${wmsTables.shipmentLines.lineVersion} + 1`,
          })
          .where(
            and(
              eq(wmsTables.shipmentLines.id, take.allocation.shipmentLineId),
              gte(wmsTables.shipmentLines.inspectedQty, take.qty),
            ),
          )
          .returning({ id: wmsTables.shipmentLines.id });
        if (!line) {
          throw new ConflictException({
            code: 'SHIPMENT_LINE_INSPECTION_STALE',
            message: `Line ${take.allocation.shipmentLineId} inspected quantity is below the packed custody`,
          });
        }
      }
    }
    return input.quantity;
  }

  /**
   * 토탈피킹 카트 여분을 되돌림 바구니로(정한 것 2). 카트의 물건은 누구 몫인지 모른다 — 빼는 박스들의 «미귀속 배정»
   * (배정 − 그 줄·로케이션의 박스 보관)이 카트에서 내릴 수 있는 양이다. 호출자가 구성요소·카트·작업 항목·세션을 잠갔다.
   * 내린 뒤에도 AT_SOURCE + BULK_CART = Σ 미귀속 배정 이라 남는 박스의 분류는 그대로 채워진다.
   */
  async removeCartShare(
    input: {
      session: BatchInventorySessionRow;
      workItemIds: string[];
      cartRef: string;
      skuId: string;
      sourceLocationId: string;
      quantity: number;
      returnBin: ReturnBinRef;
      actorId: string;
      operationId: string;
    },
    trx: DbTx,
  ): Promise<Array<{ workItemId: string; qty: number }>> {
    if (!input.workItemIds.length) {
      throw new ConflictException({ code: 'CART_SURPLUS_NOT_PENDING', message: 'No leaving box holds this SKU on a cart' });
    }
    const allocations = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        workItemId: wmsTables.pickingSourceAllocations.workItemId,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          inArray(wmsTables.pickingSourceAllocations.workItemId, input.workItemIds),
          eq(wmsTables.shipmentLines.skuId, input.skuId),
          eq(wmsTables.pickingSourceAllocations.sourceLocationId, input.sourceLocationId),
          gt(wmsTables.pickingSourceAllocations.qty, 0),
        ),
      )
      .orderBy(asc(wmsTables.pickingSourceAllocations.workItemId), asc(wmsTables.pickingSourceAllocations.id));
    // 보관 행은 lockOpenSession 이 잠갔다.
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id),
          eq(wmsTables.batchInventorySessionBalances.skuId, input.skuId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, input.sourceLocationId),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      );
    const cartQty = balances
      .filter((b) => b.custodyType === 'BULK_CART' && b.custodyRef === input.cartRef && b.shipmentLineId === null)
      .reduce((total, b) => total + b.qty, 0);
    const inBox = new Map<string, number>();
    for (const b of balances) {
      if (b.shipmentLineId && (BOX_CUSTODY_TYPES as readonly string[]).includes(b.custodyType)) {
        inBox.set(b.shipmentLineId, (inBox.get(b.shipmentLineId) ?? 0) + b.qty);
      }
    }
    // 빼는 작업 항목마다 (줄, 로케이션) 배정 행은 하나다(uq_picking_source_allocations_work_item_grain).
    const shares = allocations
      .map((a) => ({ ...a, unpicked: a.qty - Math.min(a.qty, inBox.get(a.shipmentLineId) ?? 0) }))
      .filter((a) => a.unpicked > 0);
    const available = Math.min(
      cartQty,
      shares.reduce((total, a) => total + a.unpicked, 0),
    );
    if (input.quantity > available) {
      throw new ConflictException({
        code: 'CART_SURPLUS_NOT_PENDING',
        message: `Cart ${input.cartRef} can return at most ${available} of SKU ${input.skuId} for leaving boxes`,
      });
    }
    const moved = new Map<string, number>();
    let remaining = input.quantity;
    for (const share of shares) {
      if (remaining === 0) break;
      const qty = Math.min(remaining, share.unpicked);
      // 배정 행의 workItemId 는 inArray(workItemIds) 로 골랐으니 null 이 아니다.
      const workItemId = share.workItemId!;
      await this.sessions.removeToReturnBin(
        {
          sessionId: input.session.id,
          operationId: input.operationId,
          actorId: input.actorId,
          workItemId,
          allocationId: share.allocationId,
          shipmentLineId: share.shipmentLineId,
          skuId: input.skuId,
          sourceLocationId: input.sourceLocationId,
          quantity: qty,
          from: { custodyType: 'BULK_CART', custodyRef: input.cartRef, shipmentLineId: null },
          returnBin: input.returnBin,
        },
        trx,
      );
      await this.decrementAllocation(share.allocationId, qty, trx);
      moved.set(workItemId, (moved.get(workItemId) ?? 0) + qty);
      remaining -= qty;
    }
    return [...moved].map(([workItemId, qty]) => ({ workItemId, qty }));
  }

  /** 배정 감소 CAS — 반납·되돌림이 같이 쓴다. 행은 지우지 않는다(0 허용, 스펙 §11). */
  private async decrementAllocation(allocationId: string, qty: number, trx: DbTx): Promise<void> {
    const [reduced] = await trx
      .update(wmsTables.pickingSourceAllocations)
      .set({ qty: sql`${wmsTables.pickingSourceAllocations.qty} - ${qty}` })
      .where(
        and(eq(wmsTables.pickingSourceAllocations.id, allocationId), gte(wmsTables.pickingSourceAllocations.qty, qty)),
      )
      .returning({ id: wmsTables.pickingSourceAllocations.id });
    if (!reduced) {
      throw new ConflictException({
        code: 'PICKING_ALLOCATION_STALE',
        error: 'PICKING_ALLOCATION_STALE',
        message: `Allocation ${allocationId} changed`,
      });
    }
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
