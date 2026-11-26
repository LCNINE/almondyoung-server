/**
 * 출고를 되돌려 출고 준비로 돌아온 상자 — 상자의 마지막 출고 시도가 되돌림(recalled)으로 끝난 상자다.
 * 다시 출고하면 새 시도가 생기므로 그 뒤로는 여기 들지 않는다.
 */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DbTx, wmsTables } from '../../inventory/schema/inventory.schema';
import { SHIPMENT_OPERATION_REASONS } from '../shipment/shipment-operation-reasons';

export interface RecallReturn {
  recalledAt: Date;
  // 되돌릴 때 고른 사유 코드. 기록에서 찾지 못하면 null
  reasonCode: string | null;
  reason: string | null;
}

const RECALL_LABELS = new Map(SHIPMENT_OPERATION_REASONS.recall.map((option) => [option.code, option.label]));

export async function loadRecallReturns(trx: DbTx, shipmentIds: readonly string[]): Promise<Map<string, RecallReturn>> {
  const returns = new Map<string, RecallReturn>();

  if (shipmentIds.length === 0) {
    return returns;
  }

  const attempts = wmsTables.dispatchAttempts;
  const latest = await trx
    .selectDistinctOn([attempts.shipmentId], {
      shipmentId: attempts.shipmentId,
      status: attempts.status,
      recalledAt: attempts.recalledAt,
    })
    .from(attempts)
    .where(inArray(attempts.shipmentId, [...shipmentIds]))
    .orderBy(asc(attempts.shipmentId), desc(attempts.attemptNo));
  const recalled = latest.filter(
    (attempt): attempt is typeof attempt & { recalledAt: Date } =>
      attempt.status === 'recalled' && attempt.recalledAt !== null,
  );

  if (recalled.length === 0) {
    return returns;
  }

  const operations = wmsTables.shipmentOperations;
  const members = wmsTables.shipmentOperationMembers;
  const reasons = await trx
    .selectDistinctOn([members.shipmentId], {
      shipmentId: members.shipmentId,
      reasonCode: operations.reasonCode,
    })
    .from(members)
    .innerJoin(operations, eq(operations.id, members.operationId))
    .where(
      and(
        inArray(
          members.shipmentId,
          recalled.map((attempt) => attempt.shipmentId),
        ),
        eq(members.role, 'source'),
        eq(operations.type, 'recall'),
        eq(operations.status, 'completed'),
      ),
    )
    .orderBy(asc(members.shipmentId), desc(operations.completedAt), desc(operations.id));
  const reasonByShipment = new Map(reasons.map((row) => [row.shipmentId, row.reasonCode]));

  for (const attempt of recalled) {
    const reasonCode = reasonByShipment.get(attempt.shipmentId) ?? null;

    returns.set(attempt.shipmentId, {
      recalledAt: attempt.recalledAt,
      reasonCode,
      reason: reasonCode ? (RECALL_LABELS.get(reasonCode) ?? reasonCode) : null,
    });
  }

  return returns;
}
