import { ConflictException, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BatchControlledStockGuard } from '../../inventory/core/services/batch-controlled-stock.guard';
import { lockSkuCapacities } from '../picking/allocation/allocation.locks';
import { SessionStartAllocation } from '../picking/allocation/allocation.types';
import {
  ReconcileAllocationRow,
  ReconcilePlan,
  atSourceKey,
  reconcileAllocation,
} from '../picking/allocation/reconcile-allocation';
import {
  BOX_CUSTODY_TYPES,
  BatchInventorySessionRow,
  BatchInventorySessionService,
  ReturnBinRef,
  ApprovedShortageReasonCode,
  shortageIdempotencyKey,
} from './batch-inventory-session.service';
import { LINE_ATTRIBUTED_CUSTODY } from './line-attributed-custody';

export interface ShortageRequest {
  shipmentLineId: string;
  sourceLocationId: string;
  qty: number;
}

export interface PlannedShortage {
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  /** 보고 시점 배정(감소 전) — 결품 오퍼레이션 의도에 적는다. */
  allocationQty: number;
  qty: number;
}

export interface RefillView {
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
}

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
    const { rows, atSource } = await this.loadReconcileState(
      input.session.id,
      input.workItemId,
      new Set(input.lines.map((line) => line.id)),
      trx,
    );
    const plan = reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: 0 })),
      // 반납 대상은 배정이 남은 행뿐이다.
      allocations: rows.filter((row) => row.qty > 0),
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

  /** reconcileAllocation 의 입력 — 이 작업 항목의 배정 행(로케이션 코드 포함)과 줄 귀속 보관, 세션 공유 AT_SOURCE. 보관 행은 lockOpenSession 이 잠갔다. */
  private async loadReconcileState(
    sessionId: string,
    workItemId: string,
    lineIds: ReadonlySet<string>,
    trx: DbTx,
  ): Promise<{ rows: ReconcileAllocationRow[]; atSource: Map<string, number> }> {
    // qty > 0 조건이 없다 — 재배정은 0 이 된 행도 «늘릴 행» 후보로 본다(reconcileAllocation 은 0 행을 무해하게 다룬다).
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
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, workItemId));
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
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
    return {
      rows: rows.map((row) => ({
        ...row,
        // I3 이 지켜졌다면 귀속 ≤ 배정이다. 넘으면 reconcileAllocation 이 입력 오류로 던진다 — 조용히 자르지 않는다.
        attributedQty: attributed.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0,
      })),
      atSource,
    };
  }

  /**
   * 결품 = 안 집은 몫(PR 4 계획이 정함 1). 판정만 한다 — 배정 행을 잠그고 요청 전부를 판정해, 모자라면 쓰기 전에 전부 보고한다.
   * 쓰기(approveShortages)와 나눈 이유: 세션의 부족 승인은 결품 오퍼레이션의 의도(보고 시점 배정 `allocationQty` 포함)를 읽는다 —
   * 호출자가 이 결과로 의도를 적은 오퍼레이션 행을 만든 뒤에 쓴다. 호출자가 구성요소·작업 항목·세션을 잠갔다.
   */
  async planShortages(
    input: { session: BatchInventorySessionRow; workItemId: string; shortages: ShortageRequest[] },
    trx: DbTx,
  ): Promise<PlannedShortage[]> {
    const rows = await trx
      .select({
        allocationId: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(eq(wmsTables.pickingSourceAllocations.workItemId, input.workItemId))
      .orderBy(asc(wmsTables.pickingSourceAllocations.id))
      .for('update');
    const balances = await trx
      .select()
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, input.session.id),
          gt(wmsTables.batchInventorySessionBalances.qty, 0),
        ),
      );
    const atSource = new Map<string, number>();
    const attributed = new Map<string, number>();
    for (const balance of balances) {
      if (!balance.sourceLocationId) continue;
      if (balance.custodyType === 'AT_SOURCE') {
        const key = atSourceKey(balance.skuId, balance.sourceLocationId);
        atSource.set(key, (atSource.get(key) ?? 0) + balance.qty);
      } else if (balance.shipmentLineId && LINE_ATTRIBUTED_CUSTODY.has(balance.custodyType)) {
        const key = `${balance.shipmentLineId}|${balance.sourceLocationId}`;
        attributed.set(key, (attributed.get(key) ?? 0) + balance.qty);
      }
    }
    const planned: Array<{ row: (typeof rows)[number]; qty: number }> = [];
    const errors: Array<{
      shipmentLineId: string;
      sourceLocationId: string;
      requestedQty: number;
      unpickedQty: number;
    }> = [];
    const takenAtSource = new Map<string, number>();
    const requests = [...input.shortages].sort((left, right) =>
      `${left.shipmentLineId}|${left.sourceLocationId}`.localeCompare(
        `${right.shipmentLineId}|${right.sourceLocationId}`,
      ),
    );
    for (const request of requests) {
      const row = rows.find(
        (r) => r.shipmentLineId === request.shipmentLineId && r.sourceLocationId === request.sourceLocationId,
      );
      if (!row) {
        throw new ConflictException({
          code: 'SHORT_PICK_ALLOCATION_MISMATCH',
          message: `No allocation for ${request.shipmentLineId}/${request.sourceLocationId} on work item ${input.workItemId}`,
        });
      }
      const key = atSourceKey(row.skuId, row.sourceLocationId);
      const unpicked = Math.min(
        row.qty - (attributed.get(`${row.shipmentLineId}|${row.sourceLocationId}`) ?? 0),
        (atSource.get(key) ?? 0) - (takenAtSource.get(key) ?? 0),
      );
      if (request.qty > unpicked) {
        errors.push({
          shipmentLineId: request.shipmentLineId,
          sourceLocationId: request.sourceLocationId,
          requestedQty: request.qty,
          unpickedQty: Math.max(0, unpicked),
        });
        continue;
      }
      takenAtSource.set(key, (takenAtSource.get(key) ?? 0) + request.qty);
      planned.push({ row, qty: request.qty });
    }
    if (errors.length) {
      throw new ConflictException({
        code: 'SHORT_PICK_EXCEEDS_UNPICKED',
        message: 'Short quantity exceeds the unpicked share at the location',
        errors,
      });
    }
    return planned.map(({ row, qty }) => ({
      allocationId: row.allocationId,
      shipmentLineId: row.shipmentLineId,
      skuId: row.skuId,
      sourceLocationId: row.sourceLocationId,
      allocationQty: row.qty,
      qty,
    }));
  }

  /**
   * planShortages 의 결과를 적용한다 — 배정마다 AT_SOURCE 에서 부족 승인 + 배정 −k 를 같은 트랜잭션에서(복구 규칙 정한 것 9).
   * 배정 행·보관 행은 planShortages·lockOpenSession 이 잠갔다. 세션이 «안 집은 몫» 을 다시 검사한다(방어선).
   */
  async approveShortages(
    input: {
      session: BatchInventorySessionRow;
      workItemId: string;
      shortPickOperationId: string;
      actorId: string;
      reasonCode: ApprovedShortageReasonCode;
      reason: string;
      planned: PlannedShortage[];
    },
    trx: DbTx,
  ): Promise<void> {
    for (const shortage of input.planned) {
      await this.sessions.approveShortage(
        {
          sessionId: input.session.id,
          idempotencyKey: shortageIdempotencyKey(input.shortPickOperationId, shortage.allocationId),
          shortPickOperationId: input.shortPickOperationId,
          workItemId: input.workItemId,
          allocationId: shortage.allocationId,
          shipmentLineId: shortage.shipmentLineId,
          quantity: shortage.qty,
          from: { skuId: shortage.skuId, sourceLocationId: shortage.sourceLocationId, custodyType: 'AT_SOURCE' },
          reasonCode: input.reasonCode,
          reason: input.reason,
          approverId: input.actorId,
        },
        trx,
      );
      await this.decrementAllocation(shortage.allocationId, shortage.qty, trx);
    }
  }

  /**
   * 결품 뒤 목표(줄 수량)로 되돌리는 계획(스펙 §9-3, 정한 것 5). 쓰지 않는다. 후보에서 이번 결품의 (SKU, 로케이션)을 뺀다 —
   * 원장은 그대로라 그 로케이션에 유령 재고가 일반 가용으로 보인다(정한 것 2). 모자란 줄이 있는 SKU 만 가용 잠금을 잡는다.
   */
  async planRefill(
    input: {
      session: BatchInventorySessionRow;
      warehouseId: string;
      workItemId: string;
      lines: Array<{ id: string; skuId: string; qty: number }>;
      excludedSources: ReadonlyArray<{ skuId: string; sourceLocationId: string }>;
    },
    trx: DbTx,
  ): Promise<ReconcilePlan> {
    const { rows, atSource } = await this.loadReconcileState(
      input.session.id,
      input.workItemId,
      new Set(input.lines.map((line) => line.id)),
      trx,
    );
    const allocated = new Map<string, number>();
    for (const row of rows) allocated.set(row.shipmentLineId, (allocated.get(row.shipmentLineId) ?? 0) + row.qty);
    const deficitSkus = input.lines
      .filter((line) => (allocated.get(line.id) ?? 0) < line.qty)
      .map((line) => line.skuId);
    const excluded = new Set(input.excludedSources.map((source) => atSourceKey(source.skuId, source.sourceLocationId)));
    const { capacities, inboundPendingBySku } = deficitSkus.length
      ? await lockSkuCapacities(trx, this.controlledStock, input.warehouseId, deficitSkus)
      : { capacities: [], inboundPendingBySku: new Map<string, number>() };
    return reconcileAllocation({
      workItemId: input.workItemId,
      targets: input.lines.map((line) => ({ shipmentLineId: line.id, skuId: line.skuId, targetQty: line.qty })),
      allocations: rows,
      atSource,
      capacities: capacities.filter(
        (capacity) => !excluded.has(atSourceKey(capacity.skuId, capacity.sourceLocationId)),
      ),
      inboundPendingBySku,
    });
  }

  /**
   * 재배정 계획을 적용한다 — 같은 (작업 항목, 줄, 로케이션) 행이 있으면 늘리고(원래 source_stock_version 유지 — 복구가 인계 이벤트와
   * 견준다), 없으면 만든다. 그리고 실행 중 세션에 인계한다(키 `hand-in:<명령 id>:<배정 id>`).
   */
  async applyRefill(
    input: {
      session: BatchInventorySessionRow;
      batchId: string;
      actorId: string;
      operationId: string;
      plan: ReconcilePlan;
      lines: Array<{ id: string; skuId: string }>;
    },
    trx: DbTx,
  ): Promise<RefillView[]> {
    const { plan } = input;
    if (
      plan.shortages.length ||
      plan.handBacks.length ||
      plan.cartSurplus.length ||
      plan.excess.length ||
      !plan.handIns.length
    ) {
      throw new Error('applyRefill: a refill plan must be a non-empty pure hand-in');
    }
    const A = wmsTables.pickingSourceAllocations;
    const skuByLine = new Map(input.lines.map((line) => [line.id, line.skuId]));
    const allocations: SessionStartAllocation[] = [];
    for (const draft of plan.handIns) {
      const [grown] = await trx
        .update(A)
        .set({ qty: sql`${A.qty} + ${draft.qty}` })
        .where(
          and(
            eq(A.workItemId, draft.workItemId),
            eq(A.shipmentLineId, draft.shipmentLineId),
            eq(A.sourceLocationId, draft.sourceLocationId),
          ),
        )
        .returning();
      const row = grown ?? (await trx.insert(A).values(draft).returning())[0];
      allocations.push({
        id: row.id,
        // holds because every draft carries the refilled work item id (planRefill's workItemId).
        workItemId: row.workItemId!,
        shipmentLineId: row.shipmentLineId,
        // holds because plan.handIns came from input.lines' targets.
        skuId: skuByLine.get(row.shipmentLineId)!,
        sourceLocationId: row.sourceLocationId,
        quantity: draft.qty,
        sourceStockVersion: row.sourceStockVersion,
      });
    }
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
    const codes = await trx
      .select({ id: wmsTables.locations.id, code: wmsTables.locations.code })
      .from(wmsTables.locations)
      .where(inArray(wmsTables.locations.id, [...new Set(plan.handIns.map((draft) => draft.sourceLocationId))]));
    const codeById = new Map(codes.map((row) => [row.id, row.code]));
    return plan.handIns.map((draft) => ({
      shipmentLineId: draft.shipmentLineId,
      // holds because plan.handIns came from input.lines' targets.
      skuId: skuByLine.get(draft.shipmentLineId)!,
      sourceLocationId: draft.sourceLocationId,
      locationCode: codeById.get(draft.sourceLocationId) ?? '',
      qty: draft.qty,
    }));
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
    const takes: Array<{ allocation: (typeof allocations)[number]; balance: (typeof custody)[number]; qty: number }> =
      [];
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
   * (배정 − 그 줄·로케이션의 박스 보관)이 카트에서 내릴 수 있는 양이다. 호출자가 카트·구성요소·작업 항목·세션을 이 순서로 잠갔다.
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
      throw new ConflictException({
        code: 'CART_SURPLUS_NOT_PENDING',
        message: 'No leaving box holds this SKU on a cart',
      });
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
    const shares = allocations.flatMap((a) => {
      // 배정 행의 workItemId 는 inArray(workItemIds) 로 골랐으니 null 일 수 없다 — 타입만 좁힌다.
      if (a.workItemId === null) return [];
      const unpicked = a.qty - Math.min(a.qty, inBox.get(a.shipmentLineId) ?? 0);
      return unpicked > 0 ? [{ ...a, workItemId: a.workItemId, unpicked }] : [];
    });
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
      const workItemId = share.workItemId;
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
