import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { databaseNow } from '../picking/allocation/allocation.queries';
import { WaybillService } from '../waybill/waybill.service';
import { BatchInventorySessionRow } from './batch-inventory-session.service';
import { BoxAllocationManager } from './box-allocation.manager';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { ToteLifecycleService } from './tote-lifecycle.service';
import { WITHDRAWABLE_WORK_ITEM_STATUSES, WorkItemExitTo } from './work-item-status';

export type WorkItemRow = typeof wmsTables.outboundBatchWorkItems.$inferSelect;
const WI = wmsTables.outboundBatchWorkItems;
const A = wmsTables.pickingSourceAllocations;

export interface BeginWithdrawalInput {
  batchId: string;
  shipmentId: string;
  shipmentStatus: string;
  /** 호출자가 FOR UPDATE 로 잠근 활성 작업 항목. */
  workItem: WorkItemRow;
  lines: Array<{ id: string; skuId: string }>;
  exitTo: WorkItemExitTo;
  reason: string;
  /** 전체 취소 연결(E10)의 취소 오퍼레이션. 운영자 빼기는 null. */
  waitingOperationId: string | null;
  actorId: string;
  /** 명령 id — 세션 이벤트 멱등 키와 나갈 때의 송장 무효화 키에 쓴다. */
  operationId: string;
}

export interface BeginWithdrawalResult {
  kind: 'withdrawing' | 'exited';
  workItem: WorkItemRow;
  handedBackQty: number;
}

function conflict(code: string, message: string): ConflictException {
  return new ConflictException({ code, message });
}

/**
 * 시작된 배치에서 박스가 빠지는 일의 생명주기(스펙 §8). 목표를 0 으로 두고 — 집지 않은 몫은 즉시 반납, 집은 몫과 카트 몫은
 * 되돌림 바구니로 들어갈 때 배정이 준다 — 배정 합이 0 이 되는 트랜잭션에서 나간다.
 * 호출자: 운영자 빼기(`OutboundBatchOrchestrator.excludeShipment`), 전체 취소(`ShipmentPlanningService.cancelOutstanding`),
 * 되돌림(`BoxReturnService`, 토탈피킹 전략의 카트 여분). PR 4 의 «결품 못 채움» 도 여기로 온다.
 *
 * 계획·오케스트레이터를 모른다(그 둘이 이 서비스를 주입받는다). 그래서 `canceled` 로 나간 박스의 취소 완료
 * (`ShipmentPlanningService.finishWithdrawnCancellation`)와 `draft` 로 나간 박스의 대기 오퍼레이션 재개는 호출자가 한다.
 */
@Injectable()
export class BoxWithdrawalService {
  constructor(
    private readonly invariant: FulfillmentInvariantService,
    private readonly boxes: BoxAllocationManager,
    private readonly totes: ToteLifecycleService,
    private readonly waybills: WaybillService,
    private readonly audit: AuditService,
  ) {}

  /**
   * 이탈을 막는 사유(정한 것 3). 쓰지 않는다 — 세션만 잠근다(호출자가 구성요소·작업 항목을 이미 잡았다).
   * 전체 취소(E10)는 이걸로 이탈 갈래와 옛 대기 갈래를 가른다.
   */
  async blockerOf(
    input: { batchId: string; shipmentId: string; shipmentStatus: string; workItem: WorkItemRow },
    trx: DbTx,
  ): Promise<{ blocker: { code: string; message: string } } | { session: BatchInventorySessionRow }> {
    if (input.workItem.status === 'short_pick_recovery') {
      return {
        blocker: {
          code: 'WORK_ITEM_ALLOCATED',
          message: 'Work item is in short-pick recovery; use short-pick recovery',
        },
      };
    }
    const [attempt] = await trx
      .select({ id: wmsTables.dispatchAttempts.id })
      .from(wmsTables.dispatchAttempts)
      .where(
        and(
          eq(wmsTables.dispatchAttempts.shipmentId, input.shipmentId),
          ne(wmsTables.dispatchAttempts.status, 'recalled'),
        ),
      )
      .limit(1);
    if (attempt || ['shipped', 'in_transit', 'delivered'].includes(input.shipmentStatus)) {
      return {
        blocker: {
          code: 'WORK_ITEM_DISPATCH_EXISTS',
          message: 'A dispatched shipment cannot be excluded from a batch',
        },
      };
    }
    const session = await this.boxes.lockOpenSession(input.batchId, trx);
    if (!session || session.status !== 'active') {
      return {
        blocker: {
          code: 'PICKING_SESSION_NOT_ACTIVE',
          message: `Batch ${input.batchId} inventory session is ${session?.status ?? 'not open'}`,
        },
      };
    }
    return { session };
  }

  async begin(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult> {
    const item = input.workItem;
    if (item.status === 'withdrawing') return this.escalate(input, trx);
    const checked = await this.blockerOf(input, trx);
    if ('blocker' in checked) throw conflict(checked.blocker.code, checked.blocker.message);
    if (!(WITHDRAWABLE_WORK_ITEM_STATUSES as readonly string[]).includes(item.status)) {
      throw new Error(`begin: work item ${item.id} is ${item.status}`);
    }
    this.assertWaitingSlot(item, input.waitingOperationId);
    const { handedBackQty } = await this.boxes.handBackUnpicked(
      {
        session: checked.session,
        workItemId: item.id,
        lines: input.lines,
        actorId: input.actorId,
        operationId: input.operationId,
      },
      trx,
    );
    const now = await databaseNow(trx);
    const [withdrawing] = await trx
      .update(WI)
      .set({
        status: 'withdrawing',
        exitTo: input.exitTo,
        exclusionReason: input.reason,
        waitingOperationId: input.waitingOperationId ?? item.waitingOperationId,
        pickerReleasedAt: item.status === 'picking' ? now : item.pickerReleasedAt,
        packerReleasedAt: item.status === 'packing' ? now : item.packerReleasedAt,
        leaseExpiresAt: null,
        leaseVersion: item.leaseVersion + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(WI.id, item.id),
          eq(WI.leaseVersion, item.leaseVersion),
          inArray(WI.status, [...WITHDRAWABLE_WORK_ITEM_STATUSES]),
        ),
      )
      .returning();
    if (!withdrawing) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${item.id} changed while withdrawing`);
    const exit = await this.exitIfDrained(withdrawing, { actorId: input.actorId, operationId: input.operationId }, trx);
    return { kind: exit.exited ? 'exited' : 'withdrawing', workItem: exit.workItem, handedBackQty };
  }

  /**
   * 나가기(정한 것 4). 배정 합이 0 이 아니면 아무것도 하지 않는다. 호출자가 구성요소·작업 항목을 잡았다.
   * (`exit_to = canceled` 의 송장 무효화는 Task 8 이 이 메서드에 더한다 — 그 전에는 canceled 로 이탈을 시작하는 호출자가 없다.)
   */
  async exitIfDrained(
    workItem: WorkItemRow,
    ctx: { actorId: string; operationId: string },
    trx: DbTx,
  ): Promise<{ exited: boolean; workItem: WorkItemRow }> {
    if (workItem.status !== 'withdrawing')
      throw new Error(`exitIfDrained: work item ${workItem.id} is ${workItem.status}`);
    const [row] = await trx
      .select({ qty: sql<number>`coalesce(sum(${A.qty}), 0)::int` })
      .from(A)
      .where(eq(A.workItemId, workItem.id));
    if (Number(row?.qty ?? 0) > 0) return { exited: false, workItem };
    const [excluded] = await trx
      .update(WI)
      .set({ status: 'excluded', leaseExpiresAt: null, leaseVersion: workItem.leaseVersion + 1, updatedAt: sql`now()` })
      .where(and(eq(WI.id, workItem.id), eq(WI.leaseVersion, workItem.leaseVersion), eq(WI.status, 'withdrawing')))
      .returning();
    if (!excluded) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${workItem.id} changed while exiting`);
    const totes = await this.totes.releaseEmptyAssignmentsForShipment(
      { shipmentId: excluded.shipmentId, operationId: ctx.operationId },
      trx,
    );
    await this.audit.logUserActionRequired(
      'outbound_batch.shipment.exit',
      'fulfillment',
      `Work item ${excluded.id} left batch ${excluded.batchId}`,
      { userId: ctx.actorId },
      {
        operationId: ctx.operationId,
        shipmentId: excluded.shipmentId,
        exitTo: excluded.exitTo,
        waitingOperationId: excluded.waitingOperationId,
        releasedToteAssignmentIds: totes.releasedAssignmentIds,
      },
      trx,
    );
    return { exited: true, workItem: excluded };
  }

  /** 박스들의 구성요소를 불변식 검사기로 잠근다 — 되돌림 명령의 첫 잠금(스펙 §13 순서의 맨 앞). */
  async lockComponentsOf(shipmentIds: string[], trx: DbTx): Promise<void> {
    if (!shipmentIds.length) return;
    const rows = await trx
      .selectDistinct({ id: wmsTables.fulfillmentOrderItems.fulfillmentOrderId })
      .from(wmsTables.shipmentLines)
      .innerJoin(
        wmsTables.fulfillmentOrderItems,
        eq(wmsTables.fulfillmentOrderItems.id, wmsTables.shipmentLines.fulfillmentOrderItemId),
      )
      .where(inArray(wmsTables.shipmentLines.shipmentId, shipmentIds));
    if (!rows.length) throw new NotFoundException(`Shipments ${shipmentIds.join(',')} have no lines`);
    await this.invariant.assertFulfillmentOrders(rows.map((row) => row.id).sort(), trx);
  }

  /** 이미 빼는 중 — 전체 취소만 draft → canceled 로 올린다(정한 것 5). */
  private async escalate(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult> {
    const item = input.workItem;
    if (input.exitTo !== 'canceled' || item.exitTo !== 'draft') {
      throw conflict(
        'SHIPMENT_ALREADY_WITHDRAWING',
        `Shipment ${input.shipmentId} is already leaving batch ${item.batchId}`,
      );
    }
    this.assertWaitingSlot(item, input.waitingOperationId);
    const [updated] = await trx
      .update(WI)
      .set({ exitTo: 'canceled', waitingOperationId: input.waitingOperationId, updatedAt: sql`now()` })
      .where(and(eq(WI.id, item.id), eq(WI.status, 'withdrawing')))
      .returning();
    if (!updated) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${item.id} changed while escalating`);
    return { kind: 'withdrawing', workItem: updated, handedBackQty: 0 };
  }

  private assertWaitingSlot(item: WorkItemRow, waitingOperationId: string | null): void {
    if (waitingOperationId && item.waitingOperationId && item.waitingOperationId !== waitingOperationId) {
      throw conflict(
        'CANCELLATION_WORK_ITEM_ALREADY_WAITING',
        `Work item ${item.id} already waits for operation ${item.waitingOperationId}`,
      );
    }
  }
}
