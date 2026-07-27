import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { DbService, InjectTypedDb } from '@app/db';
import { ScopeAuthorizationDecision } from '@app/authorization';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsSchema, wmsTables } from '../../inventory/schema/inventory.schema';
import { OutboundBatchOrchestrator } from './outbound-batch-orchestrator.service';
import { PickingProcessService } from './picking-process.service';
import { FulfillmentWorkflowGate } from './fulfillment-workflow-gate.service';
import { FulfillmentCommandService } from './fulfillment-command.service';
import { ShipmentDispatchService } from './shipment-dispatch.service';
import { BarcodeService } from '../../inventory/shared/services/barcode.service';
import { resolveSkuIdByBarcode } from './sku-barcode-resolution';

export interface SimpleOutboundActor {
  id: string;
  roles: string[];
}

export interface SimpleOutboundContext {
  batchId: string;
  workItemId: string;
  shipmentId: string;
  planId: string;
  sessionId: string;
  leaseVersion: number;
}

export interface SimpleOutboundLineProgress {
  shipmentLineId: string;
  skuId: string;
  qty: number;
  pickedQty: number;
  inspectedQty: number;
}

export interface SimpleOutboundState {
  shipmentId: string;
  workItemStatus: string;
  status: 'in_progress' | 'shipped';
  dispatchAttemptId: string | null;
  lines: SimpleOutboundLineProgress[];
}

const PICKABLE_WORK_ITEM_STATUSES = ['queued', 'picking', 'ready_to_pack', 'packing'] as const;
// DiscretePickingStrategy.assertPlanningEligibility 는 plan 멤버십을 ACTIVE_WORK_ITEM_STATUSES
// (discrete-picking.strategy.ts:33, queued·picking 만)와 정확히 일치시킨다. ensurePlan 의
// members 조회가 더 넓은 PICKABLE_WORK_ITEM_STATUSES 를 쓰면 같은 배치의 ready_to_pack/packing
// shipment 까지 plan 요청에 끼어들어 그 비교가 항상 어긋나고, PICKING_WORK_ITEM_MEMBERSHIP_MISMATCH
// 로 배치 전체(다른 queued 항목까지)가 막힌다. loadWorkItem 은 이 좁은 목록을 쓰면 안 된다 —
// 그건 "이 work item 자체가 아직 피킹 가능한가"이지 "plan 에 새로 넣을 멤버인가"가 아니다.
const PLAN_MEMBER_WORK_ITEM_STATUSES = ['queued', 'picking'] as const;

@Injectable()
export class SimpleOutboundService {
  constructor(
    @InjectTypedDb<typeof wmsSchema>() private readonly dbService: DbService<typeof wmsSchema>,
    private readonly batches: OutboundBatchOrchestrator,
    private readonly picking: PickingProcessService,
    private readonly workflowGate: FulfillmentWorkflowGate,
    private readonly commands: FulfillmentCommandService,
    private readonly dispatch: ShipmentDispatchService,
    private readonly barcode: BarcodeService,
  ) {}

  /**
   * 단순출고 스캔이 성립하기 위한 선행 상태를 확보한다 — 배치 work item 확인,
   * plan·session 생성(없을 때만), 피커 claim. 모두 호출자의 트랜잭션 안에서 돈다.
   */
  async prepare(
    shipmentId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<SimpleOutboundContext> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.prepare');
    const workItem = await this.loadWorkItem(shipmentId, tx);
    const planId = await this.ensurePlan(workItem.batchId, actor, idempotencyKey, tx);
    const sessionId = await this.ensureSession(workItem.batchId, planId, actor, idempotencyKey, tx);
    const leaseVersion = await this.ensurePickerClaim(workItem, actor, idempotencyKey, tx);
    return {
      batchId: workItem.batchId,
      workItemId: workItem.id,
      shipmentId,
      planId,
      sessionId,
      leaseVersion,
    };
  }

  async scan(
    shipmentId: string,
    input: { barcode: string; quantity: number; actor: SimpleOutboundActor; idempotencyKey: string },
    tx?: DbTx,
  ): Promise<SimpleOutboundState> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.scan');
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
      throw new BadRequestException('quantity must be a positive integer');
    }
    return this.commands.execute<SimpleOutboundState>(
      {
        commandType: 'shipment.simple_outbound.scan',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          barcode: input.barcode.trim(),
          quantity: input.quantity,
          actorId: input.actor.id,
        },
      },
      async (trx) => {
        const context = await this.prepare(shipmentId, input.actor, input.idempotencyKey, trx);
        const skuId = await this.resolveSkuId(input.barcode, trx);
        await this.pickScanned(context, skuId, input.quantity, input.actor, input.idempotencyKey, trx);
        const settled = await this.settleIfFullyPicked(context, input.actor, input.idempotencyKey, trx);
        const state = await this.loadState(context, trx);
        return {
          response: { ...state, dispatchAttemptId: settled?.dispatchAttemptId ?? null },
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: settled?.dispatchAttemptId ?? undefined,
        };
      },
      tx,
    );
  }

  /**
   * "예외적인 경우 강제출고 처리로 모두 스캔한 것으로 처리" — 남은 미피킹 수량을
   * 할당 로케이션 기준으로 강제 채운 뒤 완료하고, 실제 dispatch(권한 검사·감사
   * 로그 포함)는 `ShipmentDispatchService.forceDispatch` 에 맡긴다. 재고 부족
   * 신고 경로(short-picks)와는 무관하다 — 존재하지 않는 재고를 출고 처리하지 않는다.
   */
  async forceComplete(
    shipmentId: string,
    input: {
      reason: string;
      csCaseId?: string;
      note?: string;
      actor: SimpleOutboundActor;
      idempotencyKey: string;
      authorization: ScopeAuthorizationDecision | undefined;
    },
    tx?: DbTx,
  ): Promise<SimpleOutboundState> {
    this.workflowGate.assertV2MutationAllowed('shipment.simple_outbound.force');
    if (!input.reason.trim()) throw new BadRequestException('reason is required');
    return this.commands.execute<SimpleOutboundState>(
      {
        commandType: 'shipment.simple_outbound.force',
        idempotencyKey: input.idempotencyKey,
        canonicalRequest: {
          shipmentId,
          reason: input.reason.trim(),
          csCaseId: input.csCaseId?.trim() || null,
          note: input.note?.trim() || null,
          actorId: input.actor.id,
        },
      },
      async (trx) => {
        const context = await this.prepare(shipmentId, input.actor, input.idempotencyKey, trx);
        await this.forcePickRemaining(context, input.actor, input.idempotencyKey, trx);
        const [workItem] = await trx
          .select({
            status: wmsTables.outboundBatchWorkItems.status,
            leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion,
          })
          .from(wmsTables.outboundBatchWorkItems)
          .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
          .limit(1);
        if (workItem?.status === 'picking') {
          await this.picking.completePick(
            {
              batchId: context.batchId,
              planId: context.planId,
              sessionId: context.sessionId,
              workItemId: context.workItemId,
              shipmentId: context.shipmentId,
              actor: { id: input.actor.id, roles: input.actor.roles },
              expectedLeaseVersion: workItem.leaseVersion,
              idempotencyKey: `simple:${input.idempotencyKey}:complete`,
            },
            trx,
          );
        }
        const forced = await this.dispatch.forceDispatch(
          context.shipmentId,
          {
            reason: input.reason,
            csCaseId: input.csCaseId,
            note: input.note,
            actor: { id: input.actor.id, roles: input.actor.roles },
            idempotencyKey: `simple:${input.idempotencyKey}:force`,
            authorization: input.authorization,
          },
          trx,
        );
        const state = await this.loadState(context, trx);
        return {
          response: { ...state, dispatchAttemptId: forced.dispatchAttemptId },
          resourceType: 'shipment',
          resourceId: shipmentId,
          attemptId: forced.dispatchAttemptId ?? undefined,
        };
      },
      tx,
    );
  }

  /** 남은 필요 수량을 할당 로케이션 기준으로 채운다 — 작업자가 스캔을 생략한 몫이다. */
  private async forcePickRemaining(
    context: SimpleOutboundContext,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<void> {
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
        skuId: wmsTables.shipmentLines.skuId,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, context.planId),
          eq(wmsTables.shipmentLines.shipmentId, context.shipmentId),
        ),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );

    for (const allocation of allocations) {
      const attributed = await this.attributedQty(
        context.sessionId,
        allocation.shipmentLineId,
        allocation.sourceLocationId,
        tx,
      );
      const missing = allocation.qty - attributed;
      if (missing <= 0) continue;
      await this.picking.scan(
        {
          strategy: 'discrete',
          stage: 'source',
          batchId: context.batchId,
          planId: context.planId,
          sessionId: context.sessionId,
          workItemId: context.workItemId,
          shipmentId: context.shipmentId,
          shipmentLineId: allocation.shipmentLineId,
          skuId: allocation.skuId,
          sourceLocationId: allocation.sourceLocationId,
          quantity: missing,
          actor: { id: actor.id, roles: actor.roles },
          expectedLeaseVersion: context.leaseVersion,
          idempotencyKey: `simple:${idempotencyKey}:force-pick:${allocation.id}`,
        },
        tx,
      );
    }
  }

  /** 바코드 → SKU. 검수(`resolveInspectionLine`)와 같은 4단계 해석 규칙을 공유 헬퍼로 쓴다. */
  private async resolveSkuId(barcode: string, tx: DbTx): Promise<string> {
    const normalized = barcode.trim();
    if (!normalized) throw new BadRequestException('barcode is required');
    const skuId = await resolveSkuIdByBarcode(this.barcode, normalized, tx);
    if (!skuId) throw this.conflict('SIMPLE_OUTBOUND_BARCODE_UNKNOWN', 'Barcode does not resolve to a SKU');
    return skuId;
  }

  /**
   * 스캔 수량을 이 SKU 의 할당(allocation)들에 나눠 담는다. 한 라인이 여러
   * 로케이션에서 나올 수 있고(unique 키가 plan+line+location), 전략의 과다피킹
   * 가드도 로케이션 단위라 분배가 필요하다.
   */
  private async pickScanned(
    context: SimpleOutboundContext,
    skuId: string,
    quantity: number,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<void> {
    const allocations = await tx
      .select({
        id: wmsTables.pickingSourceAllocations.id,
        shipmentLineId: wmsTables.pickingSourceAllocations.shipmentLineId,
        sourceLocationId: wmsTables.pickingSourceAllocations.sourceLocationId,
        qty: wmsTables.pickingSourceAllocations.qty,
      })
      .from(wmsTables.pickingSourceAllocations)
      .innerJoin(
        wmsTables.shipmentLines,
        eq(wmsTables.shipmentLines.id, wmsTables.pickingSourceAllocations.shipmentLineId),
      )
      .where(
        and(
          eq(wmsTables.pickingSourceAllocations.planId, context.planId),
          eq(wmsTables.shipmentLines.shipmentId, context.shipmentId),
          eq(wmsTables.shipmentLines.skuId, skuId),
        ),
      )
      .orderBy(
        asc(wmsTables.pickingSourceAllocations.shipmentLineId),
        asc(wmsTables.pickingSourceAllocations.sourceLocationId),
      );
    if (allocations.length === 0) {
      throw this.conflict('SIMPLE_OUTBOUND_SKU_NOT_IN_SHIPMENT', 'Scanned SKU does not belong to this shipment');
    }

    let remaining = quantity;
    for (const allocation of allocations) {
      if (remaining === 0) break;
      const attributed = await this.attributedQty(
        context.sessionId,
        allocation.shipmentLineId,
        allocation.sourceLocationId,
        tx,
      );
      const free = allocation.qty - attributed;
      if (free <= 0) continue;
      const take = Math.min(free, remaining);
      await this.picking.scan(
        {
          strategy: 'discrete',
          stage: 'source',
          batchId: context.batchId,
          planId: context.planId,
          sessionId: context.sessionId,
          workItemId: context.workItemId,
          shipmentId: context.shipmentId,
          shipmentLineId: allocation.shipmentLineId,
          skuId,
          sourceLocationId: allocation.sourceLocationId,
          quantity: take,
          actor: { id: actor.id, roles: actor.roles },
          expectedLeaseVersion: context.leaseVersion,
          idempotencyKey: `simple:${idempotencyKey}:pick:${allocation.id}`,
        },
        tx,
      );
      remaining -= take;
    }
    if (remaining > 0) {
      throw this.conflict(
        'SIMPLE_OUTBOUND_OVERSCAN',
        `Scan exceeds the remaining allocated quantity for this SKU by ${remaining}`,
      );
    }
  }

  /** 전략의 과다피킹 가드와 같은 집계 — SETTLED 를 제외한 커스터디 합계. */
  private async attributedQty(
    sessionId: string,
    shipmentLineId: string,
    sourceLocationId: string,
    tx: DbTx,
  ): Promise<number> {
    const [row] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
          eq(wmsTables.batchInventorySessionBalances.sourceLocationId, sourceLocationId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    return Number(row?.qty ?? 0);
  }

  /** `attributedQty` 와 같은 집계를 로케이션 없이 라인 전체로 — `loadState` 와 공유한다. */
  private async pickedQtyForLine(sessionId: string, shipmentLineId: string, tx: DbTx): Promise<number> {
    const [row] = await tx
      .select({ qty: sql<number>`coalesce(sum(${wmsTables.batchInventorySessionBalances.qty}), 0)::int` })
      .from(wmsTables.batchInventorySessionBalances)
      .where(
        and(
          eq(wmsTables.batchInventorySessionBalances.sessionId, sessionId),
          eq(wmsTables.batchInventorySessionBalances.shipmentLineId, shipmentLineId),
          ne(wmsTables.batchInventorySessionBalances.custodyType, 'SETTLED'),
        ),
      );
    return Number(row?.qty ?? 0);
  }

  /**
   * 박스 전 라인이 피킹됐으면 완료 → 패커 claim → 검수를 이어서 돈다. 검수는
   * 전략 밖(shipment-dispatch)이고 완료(HAND_IN·ready_to_pack) 이후에만 성립하므로
   * 라인별로 교차할 수 없다 — 그래서 여기서 한 번에 재생한다.
   */
  private async settleIfFullyPicked(
    context: SimpleOutboundContext,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<{ dispatchAttemptId: string | null } | null> {
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        qty: wmsTables.shipmentLines.qty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
      })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, context.shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));

    const pending: Array<{ shipmentLineId: string; quantity: number }> = [];
    for (const line of lines) {
      const picked = await this.pickedQtyForLine(context.sessionId, line.id, tx);
      if (picked < line.qty) return null; // 아직 남았다 — 완료하지 않는다
      if (line.inspectedQty < line.qty) {
        pending.push({ shipmentLineId: line.id, quantity: line.qty - line.inspectedQty });
      }
    }
    if (pending.length === 0) return null;

    const [beforeComplete] = await tx
      .select({
        status: wmsTables.outboundBatchWorkItems.status,
        leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
      .limit(1);
    if (beforeComplete?.status === 'picking') {
      await this.picking.completePick(
        {
          batchId: context.batchId,
          planId: context.planId,
          sessionId: context.sessionId,
          workItemId: context.workItemId,
          shipmentId: context.shipmentId,
          actor: { id: actor.id, roles: actor.roles },
          expectedLeaseVersion: beforeComplete.leaseVersion,
          idempotencyKey: `simple:${idempotencyKey}:complete`,
        },
        tx,
      );
    }

    const [beforePack] = await tx
      .select({
        status: wmsTables.outboundBatchWorkItems.status,
        leaseVersion: wmsTables.outboundBatchWorkItems.leaseVersion,
      })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
      .limit(1);
    if (beforePack?.status === 'ready_to_pack') {
      await this.batches.claimPacker(
        context.workItemId,
        { expectedLeaseVersion: beforePack.leaseVersion },
        `simple:${idempotencyKey}:claim-packer`,
        { id: actor.id, roles: actor.roles },
        tx,
      );
    }

    const inspected = await this.dispatch.inspectShipmentLines(
      context.shipmentId,
      {
        entries: pending,
        actor: { id: actor.id, roles: actor.roles },
        idempotencyKey: `simple:${idempotencyKey}:inspect`,
      },
      tx,
    );
    return { dispatchAttemptId: inspected.dispatchAttemptId };
  }

  private async loadState(context: SimpleOutboundContext, tx: DbTx): Promise<SimpleOutboundState> {
    const lines = await tx
      .select({
        id: wmsTables.shipmentLines.id,
        skuId: wmsTables.shipmentLines.skuId,
        qty: wmsTables.shipmentLines.qty,
        inspectedQty: wmsTables.shipmentLines.inspectedQty,
      })
      .from(wmsTables.shipmentLines)
      .where(eq(wmsTables.shipmentLines.shipmentId, context.shipmentId))
      .orderBy(asc(wmsTables.shipmentLines.id));
    const progress: SimpleOutboundLineProgress[] = [];
    for (const line of lines) {
      const picked = await this.pickedQtyForLine(context.sessionId, line.id, tx);
      progress.push({
        shipmentLineId: line.id,
        skuId: line.skuId,
        qty: line.qty,
        pickedQty: Math.max(picked, line.inspectedQty),
        inspectedQty: line.inspectedQty,
      });
    }
    const [workItem] = await tx
      .select({ status: wmsTables.outboundBatchWorkItems.status })
      .from(wmsTables.outboundBatchWorkItems)
      .where(eq(wmsTables.outboundBatchWorkItems.id, context.workItemId))
      .limit(1);
    const [shipment] = await tx
      .select({ status: wmsTables.shipments.status })
      .from(wmsTables.shipments)
      .where(eq(wmsTables.shipments.id, context.shipmentId))
      .limit(1);
    return {
      shipmentId: context.shipmentId,
      workItemStatus: workItem?.status ?? 'unknown',
      status: shipment?.status === 'shipped' ? 'shipped' : 'in_progress',
      dispatchAttemptId: null,
      lines: progress,
    };
  }

  private async loadWorkItem(shipmentId: string, tx: DbTx) {
    const [workItem] = await tx
      .select()
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.shipmentId, shipmentId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...PICKABLE_WORK_ITEM_STATUSES]),
        ),
      )
      .limit(1)
      .for('update');
    if (!workItem) {
      throw this.conflict(
        'SIMPLE_OUTBOUND_WORK_ITEM_MISSING',
        'Shipment is not part of an open outbound batch — ask the manager to add it',
      );
    }
    return workItem;
  }

  private async ensurePlan(
    batchId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<string> {
    // 락 없는 fast-path 조회일 뿐이다 — 동시성 보장은 여기가 아니라 아래
    // `this.picking.plan()` 안의 `DiscretePickingStrategy.plan()`(SELECT … FOR UPDATE +
    // idempotent commands.execute)이 진다. 이 쿼리는 이미 있는 plan 을 재사용해 중복
    // plan() 호출을 피하는 최적화일 뿐, race 를 막는 가드로 취급하지 말 것.
    const [existing] = await tx
      .select({ id: wmsTables.pickingPlans.id })
      .from(wmsTables.pickingPlans)
      .where(
        and(eq(wmsTables.pickingPlans.batchId, batchId), inArray(wmsTables.pickingPlans.status, ['draft', 'active'])),
      )
      .limit(1);
    if (existing) return existing.id;

    const members = await tx
      .select({ shipmentId: wmsTables.outboundBatchWorkItems.shipmentId })
      .from(wmsTables.outboundBatchWorkItems)
      .where(
        and(
          eq(wmsTables.outboundBatchWorkItems.batchId, batchId),
          inArray(wmsTables.outboundBatchWorkItems.status, [...PLAN_MEMBER_WORK_ITEM_STATUSES]),
        ),
      )
      .orderBy(asc(wmsTables.outboundBatchWorkItems.shipmentId));
    const planned = await this.picking.plan(
      'discrete',
      {
        batchId,
        shipmentIds: members.map((member) => member.shipmentId),
        actorId: actor.id,
        idempotencyKey: `simple:${idempotencyKey}:plan`,
      },
      tx,
    );
    if (planned.state !== 'planned') {
      throw this.conflict('SIMPLE_OUTBOUND_PLAN_INVALIDATED', planned.reason);
    }
    return planned.planId;
  }

  private async ensureSession(
    batchId: string,
    planId: string,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<string> {
    // 마찬가지로 락 없는 fast-path 조회다 — 실질적인 동시성 보장은 아래 `this.picking.start()`
    // 경로의 idempotent `commands.execute` + row lock 이 진다. 여기서 걸러지지 않아도
    // 아래 호출이 안전하게 막아준다.
    const [existing] = await tx
      .select({ id: wmsTables.batchInventorySessions.id })
      .from(wmsTables.batchInventorySessions)
      .where(
        and(
          eq(wmsTables.batchInventorySessions.batchId, batchId),
          eq(wmsTables.batchInventorySessions.status, 'active'),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const started = await this.picking.start(
      { batchId, planId, actorId: actor.id, idempotencyKey: `simple:${idempotencyKey}:start` },
      tx,
    );
    if (started.state !== 'started') {
      throw this.conflict('SIMPLE_OUTBOUND_PLAN_INVALIDATED', started.reason);
    }
    return started.sessionId;
  }

  private async ensurePickerClaim(
    workItem: typeof wmsTables.outboundBatchWorkItems.$inferSelect,
    actor: SimpleOutboundActor,
    idempotencyKey: string,
    tx: DbTx,
  ): Promise<number> {
    const leaseActive = workItem.leaseExpiresAt !== null && workItem.leaseExpiresAt.getTime() > Date.now();
    if (workItem.pickerId && workItem.pickerId !== actor.id && !workItem.pickerReleasedAt && leaseActive) {
      throw this.conflict('SIMPLE_OUTBOUND_CLAIMED_BY_OTHER', 'Another worker is already picking this shipment');
    }
    // 내 것이면서 리스가 아직 살아있을 때만 짧은 경로. 만료(15분, LEASE_MS)됐으면 조용히 다시 claim 해
    // 리스를 연장한다 — 안 그러면 prepare 는 성공을 돌려주는데 이어지는 피킹 스캔이
    // `lockAndAssertPickerClaim` 의 만료 검사(discrete-picking.strategy.ts:821-822)에서 거부된다.
    // claim 의 CAS 는 `소유자 없음 OR leaseExpiresAt <= now`(outbound-batch-orchestrator.service.ts:694-697)
    // 라 만료된 자기 소유 재-claim 이 허용된다. 그 사이 남이 가져갔으면 위 가드가 CLAIMED_BY_OTHER 로 막는다.
    if (workItem.pickerId === actor.id && workItem.status !== 'queued' && leaseActive) {
      return workItem.leaseVersion;
    }

    const claimed = await this.batches.claimPicker(
      workItem.id,
      { expectedLeaseVersion: workItem.leaseVersion },
      `simple:${idempotencyKey}:claim-picker`,
      { id: actor.id, roles: actor.roles },
      tx,
    );
    return claimed.workItem.leaseVersion;
  }

  // `error` 를 `code` 와 나란히 싣는다 — GlobalExceptionFilter 는 `errorResponse.error` 가
  // 있으면 그대로 응답의 `error` 필드로 내보내고, 없으면 상태코드별 일반 문자열(409→'CONFLICT')로
  // 뭉갠다. `error` 없이 `code` 만 실으면 앱은 모든 단순출고 409 를 구분 못 하고 "다른 작업자가
  // 먼저 변경했어요" 하나로만 본다 — SKU_NOT_IN_SHIPMENT·OVERSCAN·CLAIMED_BY_OTHER 가 다 같은 문구가 된다.
  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ code, error: code, message });
  }
}
