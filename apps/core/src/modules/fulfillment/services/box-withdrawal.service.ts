import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { AuditService } from '../../inventory/shared/services/audit.service';
import { databaseNow } from '../picking/allocation/allocation.queries';
import { WaybillService } from '../waybill/waybill.service';
import type { WaybillView } from '../waybill/waybill.types';
import { isVoidableOnExit } from './exit-waybill';
import { BatchInventorySessionRow } from './batch-inventory-session.service';
import { BoxAllocationManager } from './box-allocation.manager';
import { FulfillmentInvariantService } from './fulfillment-invariant.service';
import { ShortPickExitService } from './short-pick-exit.service';
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
    private readonly shortPicks: ShortPickExitService,
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
    const session = 'blocker' in checked ? await this.sessionlessDrain(input, checked.blocker, trx) : checked.session;
    if (!(WITHDRAWABLE_WORK_ITEM_STATUSES as readonly string[]).includes(item.status)) {
      throw new Error(`begin: work item ${item.id} is ${item.status}`);
    }
    this.assertWaitingSlot(item, input.waitingOperationId);
    const { handedBackQty } = session
      ? await this.boxes.handBackUnpicked(
          {
            session,
            workItemId: item.id,
            lines: input.lines,
            actorId: input.actorId,
            operationId: input.operationId,
          },
          trx,
        )
      : { handedBackQty: 0 };
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
   * 열린 세션 없이 이탈해도 되는가 — `blockerOf` 가 막았을 때만 부른다. 된다면 null(반납할 세션 없음), 아니면 그 사유로 던진다.
   * 되는 경우는 하나: 열린 세션(active·recovery_required)이 없고(settled 이거나 아예 없음) 이 작업 항목의 배정 합이 이미 0 —
   * 반납할 것도 되돌림 바구니로 뺄 것도 없다. 결품 보고가 배치의 마지막 보관을 부족 승인해 세션이 settled 로 닫힌 경우다
   * (`ShipmentShortPickService.report`, 배치에 박스 하나 남은 전량 결품). recovery_required 는 여전히 막는다.
   * `blockerOf` 의 계약(전체 취소 E10 의 갈래)은 바꾸지 않는다 — 이 경우 박스는 같은 트랜잭션에서 나가므로 E10 이 볼 일이 없다.
   */
  private async sessionlessDrain(
    input: BeginWithdrawalInput,
    blocker: { code: string; message: string },
    trx: DbTx,
  ): Promise<null> {
    if (blocker.code !== 'PICKING_SESSION_NOT_ACTIVE') throw conflict(blocker.code, blocker.message);
    // blockerOf 가 이미 잠갔다 — 같은 행을 다시 읽어 «없음» 과 «recovery_required» 를 가른다.
    if (await this.boxes.lockOpenSession(input.batchId, trx)) throw conflict(blocker.code, blocker.message);
    const [row] = await trx
      .select({ qty: sql<number>`coalesce(sum(${A.qty}), 0)::int` })
      .from(A)
      .where(eq(A.workItemId, input.workItem.id));
    if (Number(row?.qty ?? 0) > 0) throw conflict(blocker.code, blocker.message);
    return null;
  }

  /**
   * 나가기(정한 것 4). 배정 합이 0 이 아니면 아무것도 하지 않는다. 호출자가 구성요소·작업 항목을 잡았다.
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
    // 결품으로 빠지는 박스(PR 4 계획이 정함 3)는 이 트랜잭션에서 결품을 마무리한다 — 커밋 뒤 재개할 대기가 아니므로 비운다.
    const shortPick = workItem.exitTo === 'draft' ? await this.shortPicks.pendingFor(workItem, trx) : null;
    const [excluded] = await trx
      .update(WI)
      .set({
        status: 'excluded',
        leaseExpiresAt: null,
        leaseVersion: workItem.leaseVersion + 1,
        waitingOperationId: shortPick ? null : workItem.waitingOperationId,
        updatedAt: sql`now()`,
      })
      .where(and(eq(WI.id, workItem.id), eq(WI.leaseVersion, workItem.leaseVersion), eq(WI.status, 'withdrawing')))
      .returning();
    if (!excluded) throw conflict('WORK_ITEM_STALE_LEASE_VERSION', `Work item ${workItem.id} changed while exiting`);
    const totes = await this.totes.releaseEmptyAssignmentsForShipment(
      { shipmentId: excluded.shipmentId, operationId: ctx.operationId },
      trx,
    );
    // canceled 로 나가는 박스의 종이는 영영 쓰이지 않는다 — 로컬 무효화(캐리어 호출 없음, 결품 처리와 같다).
    // 취소 오퍼레이션의 완료는 호출자가 이어서 한다(ShipmentPlanningService.finishWithdrawnCancellation).
    if (excluded.exitTo === 'canceled') await this.voidWaybillForCanceledExit(excluded.shipmentId, ctx, trx);
    if (shortPick) await this.shortPicks.finish(shortPick, ctx, trx);
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
        shortPickOperationId: shortPick?.operationId ?? null,
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

  /**
   * 나갈 때 활성 송장을 로컬 무효화할 수 있는가(결품 마무리는 보고 때 판정 — `ShipmentShortPickService`) — 활성 송장이 없거나 `registered`. 나가기(`exitIfDrained` 의 canceled
   * 갈래)와 전체 취소 연결(E10, `ShipmentPlanningService`)의 갈래가 이 판정 하나를 쓴다 — 둘이 갈리면 E10 이 이탈로 들여보낸
   * 취소가 나가는 순간 `WITHDRAWAL_WAYBILL_NOT_VOIDABLE` 로 통째로 되돌려진다.
   */
  async exitWaybill(shipmentId: string, trx: DbTx): Promise<{ active: WaybillView | null; voidable: boolean }> {
    const active = await this.waybills.getActiveWaybill(shipmentId, trx);
    return { active, voidable: isVoidableOnExit(active) };
  }

  private async voidWaybillForCanceledExit(
    shipmentId: string,
    ctx: { actorId: string; operationId: string },
    trx: DbTx,
  ): Promise<void> {
    const { active, voidable } = await this.exitWaybill(shipmentId, trx);
    if (!active) return;
    if (!voidable) {
      throw conflict(
        'WITHDRAWAL_WAYBILL_NOT_VOIDABLE',
        `Waybill ${active.id} is ${active.status}; resolve it before the canceled box can leave its batch`,
      );
    }
    await this.waybills.void(
      active.id,
      { reason: 'withdrawn:canceled' },
      `withdrawal-exit:${ctx.operationId}:${shipmentId}`,
      { id: ctx.actorId, roles: [] },
      trx,
    );
  }

  /** 이미 빼는 중 — 전체 취소만 draft → canceled 로 올린다(정한 것 5). 결품을 기다리던 박스는 취소가 넘겨받는다(PR 4 계획이 정함 7). */
  private async escalate(input: BeginWithdrawalInput, trx: DbTx): Promise<BeginWithdrawalResult> {
    const item = input.workItem;
    if (input.exitTo !== 'canceled' || item.exitTo !== 'draft' || !input.waitingOperationId) {
      throw conflict(
        'SHIPMENT_ALREADY_WITHDRAWING',
        `Shipment ${input.shipmentId} is already leaving batch ${item.batchId}`,
      );
    }
    const shortPick = await this.shortPicks.pendingFor(item, trx);
    if (shortPick) await this.shortPicks.supersede(shortPick, input.waitingOperationId, trx);
    else this.assertWaitingSlot(item, input.waitingOperationId);
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
