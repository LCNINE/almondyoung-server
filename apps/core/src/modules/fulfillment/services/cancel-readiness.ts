import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { BoxWithdrawalService, WorkItemRow } from './box-withdrawal.service';
import { ShipmentAggregate } from './shipment-aggregate';
import { ACTIVE_WORK_ITEM_STATUSES } from './work-item-status';

/** 시작된 배치 밖 상자의 취소를 막는 것(스펙 §4.1 «막힘»). `unstartedExitBlocker` 의 코드도 그대로 섞인다. */
export const CANCEL_BLOCKER = {
  /** 시작 전 배치의 작업 항목이 다른 오퍼레이션을 기다린다 */
  WORK_ITEM_WAITING_OTHER: 'WORK_ITEM_WAITING_OTHER',
  /** 활성 송장이 `pending`·`allocated`·`used` — 로컬 무효화할 수 없다 */
  WAYBILL_NOT_VOIDABLE: 'WAYBILL_NOT_VOIDABLE',
  INSPECTED_QTY: 'INSPECTED_QTY',
  UNSETTLED_CUSTODY: 'UNSETTLED_CUSTODY',
} as const;

/** 읽기 API 가 `started_batch` 를 막힘 목록에 적을 때 쓰는 코드. */
export const STARTED_BATCH_BLOCKER = 'STARTED_BATCH';

/**
 * 상자 하나의 취소 준비도 — 즉시 취소(`cancelOutstanding`)와 대기 재개(`resumePendingCancellation`)가 같은 판정을 쓴다.
 * - `ready`: 막힘 없음. 손질(시작 전 배치 빼기·`registered` 송장 무효화·planned→draft)만 하면 draft 취소로 끝난다.
 * - `started_batch`: 시작된 배치의 활성 작업 항목이 있다 — 취소는 E10 이탈이거나 대기다. 손질 대상이 아니다.
 * - `blocked`: 시작된 배치 밖인데 막힘이 있다 — 대기로 간다.
 */
export type CancelReadiness =
  | { kind: 'ready'; unstartedWorkItem: WorkItemRow | null; voidWaybill: boolean }
  | { kind: 'started_batch'; workItem: WorkItemRow; batchId: string }
  | { kind: 'blocked'; codes: string[] };

export type CancelReadinessInput = {
  aggregate: ShipmentAggregate;
  /** 재개에서 «이 취소를 기다리는» 작업 항목은 막힘이 아니다. 즉시 취소에선 null. */
  ownOperationId: string | null;
  /** 쓰기 경로는 작업 항목을 FOR UPDATE 로 잡는다. 리컨실러의 읽기 판정은 잠그지 않는다. */
  lock: boolean;
};

/** 판정을 «막힘 목록» 하나로 접는다 — 읽기 API 와 지문이 쓴다. `ready` 면 빈 배열. */
export function cancelBlockers(readiness: CancelReadiness): string[] {
  if (readiness.kind === 'ready') return [];
  if (readiness.kind === 'started_batch') return [STARTED_BATCH_BLOCKER];
  return readiness.codes;
}

/**
 * 작업 항목을 먼저 잡고(lock) 그 다음 배치의 `startedAt` 을 읽는다 — 배치 시작(`lockAggregate`)도 작업 항목을 FOR UPDATE 로
 * 잡은 뒤 `startedAt` 을 보므로, 취소와 시작이 겹치면 둘 중 하나만 이긴다. 순서를 바꾸면 «시작 전» 으로 읽고 빼는 사이
 * 배치가 시작될 수 있다.
 */
export async function assessCancelReadiness(
  withdrawals: BoxWithdrawalService,
  input: CancelReadinessInput,
  tx: DbTx,
): Promise<CancelReadiness> {
  const { aggregate } = input;
  const shipmentId = aggregate.shipment.id;
  const WI = wmsTables.outboundBatchWorkItems;
  const activeWorkItems = tx
    .select()
    .from(WI)
    .where(and(eq(WI.shipmentId, shipmentId), inArray(WI.status, [...ACTIVE_WORK_ITEM_STATUSES])))
    .orderBy(asc(WI.id))
    .limit(1);
  const [workItem] = input.lock ? await activeWorkItems.for('update') : await activeWorkItems;
  if (workItem) {
    const [batch] = await tx
      .select({ startedAt: wmsTables.outboundBatches.startedAt })
      .from(wmsTables.outboundBatches)
      .where(eq(wmsTables.outboundBatches.id, workItem.batchId))
      .limit(1);
    if (batch?.startedAt) return { kind: 'started_batch', workItem, batchId: workItem.batchId };
  }

  const codes: string[] = [];
  if (workItem) {
    if (workItem.waitingOperationId && workItem.waitingOperationId !== input.ownOperationId) {
      codes.push(CANCEL_BLOCKER.WORK_ITEM_WAITING_OTHER);
    }
    const blocker = await withdrawals.unstartedExitBlocker(
      { shipmentId, shipmentStatus: aggregate.shipment.status, lines: aggregate.lines },
      tx,
    );
    if (blocker) codes.push(blocker.code);
  }
  const { active, voidable } = await withdrawals.exitWaybill(shipmentId, tx);
  if (!voidable) codes.push(CANCEL_BLOCKER.WAYBILL_NOT_VOIDABLE);
  // 뒤의 둘은 세션이 시작돼야 생기므로 시작된 배치 밖에선 나오지 않는다 — 방어선이다(스펙 §4.1).
  if (aggregate.lines.some((line) => line.inspectedQty > 0)) codes.push(CANCEL_BLOCKER.INSPECTED_QTY);
  if (await withdrawals.hasUnsettledCustody(shipmentId, tx)) codes.push(CANCEL_BLOCKER.UNSETTLED_CUSTODY);
  if (codes.length) return { kind: 'blocked', codes: [...new Set(codes)].sort() };
  return { kind: 'ready', unstartedWorkItem: workItem ?? null, voidWaybill: active !== null };
}
