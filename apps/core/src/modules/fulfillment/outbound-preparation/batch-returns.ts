/**
 * 출고 배치에서 빠져 출고 준비로 돌아온 상자 — 상자의 마지막 작업 항목이 빠짐(excluded)으로 끝났고
 * 끝나지 않은 작업 항목이 없는 상자다. 결품으로 돌아온 상자도 여기에 든다.
 */
import { and, asc, desc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { SHIPMENT_OPERATION_REASONS } from '../shipment/shipment-operation-reasons';
import { WAYBILL_TERMINAL_STATUSES } from '../waybill/waybill.constants';

export interface ReturnedWorkItem {
  workItemId: string;
  batchNumber: string;
  exitTo: string | null;
  exclusionReason: string;
  exitedAt: Date;
}

export interface BatchExitReason {
  place: string | null;
  reason: string;
}

// 앱이 배치에서 뺄 때 고정으로 남기는 사유. 사람이 적은 사유는 그대로 보인다.
export const BATCH_EXIT_REASONS = {
  stationWithdraw: 'station_withdraw_command',
  shortPickPrefix: 'short_pick:',
  beforeStartPrefix: '작업 시작 전 뺌 — ',
  wrongBox: '잘못 넣은 상자',
  cancelWaiting: '부분 취소로 뺌',
  consolidation: '합포장',
} as const;

const SHORT_PICK_LABELS = new Map(SHIPMENT_OPERATION_REASONS.short_pick.map((option) => [option.code, option.label]));

export function batchExitReasonOf(reason: string): BatchExitReason {
  const text = reason.trim();

  if (text === BATCH_EXIT_REASONS.stationWithdraw) {
    return { place: '물류앱 출고 검수', reason: '박스 빼기' };
  }

  if (text.startsWith(BATCH_EXIT_REASONS.shortPickPrefix)) {
    const code = text.slice(BATCH_EXIT_REASONS.shortPickPrefix.length);

    return { place: '물류앱 피킹', reason: `결품 — ${SHORT_PICK_LABELS.get(code) ?? code}` };
  }

  if (text.startsWith(BATCH_EXIT_REASONS.beforeStartPrefix)) {
    return { place: '물류앱 작업 시작', reason: text.slice(BATCH_EXIT_REASONS.beforeStartPrefix.length) };
  }

  if (text === BATCH_EXIT_REASONS.wrongBox || text === BATCH_EXIT_REASONS.cancelWaiting) {
    return { place: '관리자 출고 배치', reason: text };
  }

  if (text === BATCH_EXIT_REASONS.consolidation) {
    return { place: '관리자 합포장', reason: text };
  }

  return { place: null, reason: text };
}

export async function loadReturnedWorkItems(
  trx: DbTx,
  shipmentIds: readonly string[],
): Promise<Map<string, ReturnedWorkItem>> {
  const returned = new Map<string, ReturnedWorkItem>();

  if (shipmentIds.length === 0) {
    return returned;
  }

  const workItems = wmsTables.outboundBatchWorkItems;
  const latest = await trx
    .selectDistinctOn([workItems.shipmentId], {
      id: workItems.id,
      shipmentId: workItems.shipmentId,
      status: workItems.status,
      exitTo: workItems.exitTo,
      exclusionReason: workItems.exclusionReason,
      updatedAt: workItems.updatedAt,
      batchNumber: wmsTables.outboundBatches.batchNumber,
    })
    .from(workItems)
    .innerJoin(wmsTables.outboundBatches, eq(wmsTables.outboundBatches.id, workItems.batchId))
    .where(inArray(workItems.shipmentId, [...shipmentIds]))
    .orderBy(asc(workItems.shipmentId), desc(workItems.createdAt), desc(workItems.updatedAt), desc(workItems.id));

  for (const item of latest) {
    if (item.status === 'excluded' && item.exclusionReason) {
      returned.set(item.shipmentId, {
        workItemId: item.id,
        batchNumber: item.batchNumber,
        exitTo: item.exitTo,
        exclusionReason: item.exclusionReason,
        exitedAt: item.updatedAt,
      });
    }
  }

  if (returned.size === 0) {
    return returned;
  }

  // 시각 순서와 상관없이, 아직 끝나지 않은 작업 항목이 있으면 다시 배치에 든 상자다
  const active = await trx
    .select({ shipmentId: workItems.shipmentId })
    .from(workItems)
    .where(and(inArray(workItems.shipmentId, [...returned.keys()]), ne(workItems.status, 'excluded')));

  for (const { shipmentId } of active) {
    returned.delete(shipmentId);
  }

  return returned;
}

// 살아 있는 송장(끝난 상태가 아닌 송장)이 없으면, 다시 준비할 때 새 송장을 받는다
export async function loadNeedsNewWaybill(trx: DbTx, shipmentIds: readonly string[]): Promise<Set<string>> {
  if (shipmentIds.length === 0) {
    return new Set();
  }

  const active = await trx
    .selectDistinct({ shipmentId: wmsTables.waybills.shipmentId })
    .from(wmsTables.waybills)
    .where(
      and(
        inArray(wmsTables.waybills.shipmentId, [...shipmentIds]),
        notInArray(wmsTables.waybills.status, [...WAYBILL_TERMINAL_STATUSES]),
      ),
    );
  const kept = new Set(active.map((row) => row.shipmentId));

  return new Set(shipmentIds.filter((id) => !kept.has(id)));
}
