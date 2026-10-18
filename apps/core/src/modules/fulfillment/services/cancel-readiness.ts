import { and, asc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import {
  BoxWithdrawalService,
  UnstartedExitBlocker,
  UnstartedExitBlockerCode,
  unstartedExitBlockerOf,
  WorkItemRow,
} from './box-withdrawal.service';
import { ShipmentAggregate } from './shipment-aggregate';
import { ACTIVE_WORK_ITEM_STATUSES } from './work-item-status';

/** 취소 준비도가 막힘으로 적는 코드. 앞의 넷이 대기로 보내는 막힘이고, 뒤의 둘은 읽기만 적는다. */
export const CANCEL_BLOCKER = {
  /** 시작 전 배치의 작업 항목이 다른 오퍼레이션을 기다린다 */
  WORK_ITEM_WAITING_OTHER: 'WORK_ITEM_WAITING_OTHER',
  /** 활성 송장이 `pending`·`allocated`·`used` — 로컬 무효화할 수 없다 */
  WAYBILL_NOT_VOIDABLE: 'WAYBILL_NOT_VOIDABLE',
  INSPECTED_QTY: 'INSPECTED_QTY',
  UNSETTLED_CUSTODY: 'UNSETTLED_CUSTODY',
  /** 시작된 배치의 활성 작업 항목 — 배치에서 빠질 때 기존 신호로 재개된다 */
  STARTED_BATCH: 'STARTED_BATCH',
  /** 대기 상자가 아니다 — 재개가 `CANCELLATION_SOURCE_STATE_CHANGED` 로 던진다 */
  SOURCE_STATE_CHANGED: 'SOURCE_STATE_CHANGED',
} as const;

/** 막힘 코드 전부 — 준비도의 코드와 시작 전 배치 빼기 판정(`unstartedExitBlockerOf`)의 코드. */
export type CancelBlockerCode = (typeof CANCEL_BLOCKER)[keyof typeof CANCEL_BLOCKER] | UnstartedExitBlockerCode;

/**
 * 상자 하나의 취소 준비도 — 즉시 취소(`cancelOutstanding`)와 대기 재개(`resumePendingCancellation`)가 같은 판정을 쓴다.
 * - `ready`: 막힘 없음. `steps`(시작 전 배치 빼기·`registered` 송장 무효화·planned→draft)를 하면 draft 취소로 끝난다.
 *   비면 손질 없는 draft 취소다.
 * - `started_batch`: 시작된 배치의 활성 작업 항목이 있다 — 취소는 E10 이탈이거나 대기다. 손질 대상이 아니다.
 * - `blocked`: 시작된 배치 밖인데 막힘이 있다 — 대기로 간다.
 * - `unexcludable`: 시작 전 배치에서 뺄 수 없다(`unstartedExitBlocker`). 시작된 배치 밖에선 늘 통과하는 방어선이라 쓰기 경로는
 *   대기로 보내지 않고 그 코드로 409 를 낸다 — 대기 상자는 «안의 상자가 전부 planned» 를 깨 배치 전체의 시작을 막는다.
 */
/** 막힘 없음 갈래의 손질 한 걸음(스펙 §4.1 ①~③). 즉시 취소의 권한 검사와 손질이 같은 목록을 본다. */
export type CancelSettleStep =
  | { kind: 'exclude_unstarted'; workItem: WorkItemRow }
  | { kind: 'void_waybill' }
  | { kind: 'revert_planned' };

export type CancelReadiness =
  | { kind: 'ready'; steps: CancelSettleStep[] }
  | { kind: 'started_batch'; workItem: WorkItemRow; batchId: string }
  | { kind: 'blocked'; codes: CancelBlockerCode[] }
  | { kind: 'unexcludable'; blocker: UnstartedExitBlocker };

export type CancelReadinessInput = {
  aggregate: ShipmentAggregate;
  /** 재개에서 «이 취소를 기다리는» 작업 항목은 막힘이 아니다. 즉시 취소에선 null. */
  ownOperationId: string | null;
  /** 쓰기 경로는 작업 항목을 FOR UPDATE 로 잡는다. 리컨실러의 읽기 판정은 잠그지 않는다. */
  lock: boolean;
};

/** 판정을 «막힘 목록» 하나로 접는다 — 읽기 API 와 지문이 쓴다. `ready` 면 빈 배열. */
export function cancelBlockers(readiness: CancelReadiness): CancelBlockerCode[] {
  if (readiness.kind === 'ready') return [];
  if (readiness.kind === 'started_batch') return [CANCEL_BLOCKER.STARTED_BATCH];
  if (readiness.kind === 'unexcludable') return [readiness.blocker.code];
  return [...readiness.codes];
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

  const [exitFacts, { active, voidable }] = await Promise.all([
    withdrawals.unstartedExitFacts(aggregate, tx),
    withdrawals.exitWaybill(shipmentId, tx),
  ]);
  const codes: CancelBlockerCode[] = [];
  if (workItem?.waitingOperationId && workItem.waitingOperationId !== input.ownOperationId) {
    codes.push(CANCEL_BLOCKER.WORK_ITEM_WAITING_OTHER);
  }
  if (!voidable) codes.push(CANCEL_BLOCKER.WAYBILL_NOT_VOIDABLE);
  // 뒤의 둘은 세션이 시작돼야 생기므로 시작된 배치 밖에선 나오지 않는다 — 방어선이다(스펙 §4.1).
  if (exitFacts.inspected) codes.push(CANCEL_BLOCKER.INSPECTED_QTY);
  if (exitFacts.unsettledCustody) codes.push(CANCEL_BLOCKER.UNSETTLED_CUSTODY);
  if (codes.length) return { kind: 'blocked', codes: codes.sort() };
  // 막힘 다음에 본다 — 빼기 판정도 보관·검수 수량을 보지만(`WORK_ITEM_UNPICK_REQUIRED`) 그 둘은 409 가 아니라 대기다.
  const exitBlocker = workItem ? unstartedExitBlockerOf(exitFacts) : null;
  if (exitBlocker) return { kind: 'unexcludable', blocker: exitBlocker };
  const steps: CancelSettleStep[] = [];
  if (workItem) steps.push({ kind: 'exclude_unstarted', workItem });
  if (active) steps.push({ kind: 'void_waybill' });
  if (aggregate.shipment.status === 'planned') steps.push({ kind: 'revert_planned' });
  return { kind: 'ready', steps };
}
