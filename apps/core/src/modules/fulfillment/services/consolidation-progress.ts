import {
  ConsolidationProgressResponseDto,
  ConsolidationProgressSourceDto,
  ShipmentOperationStatus,
} from '../dto/consolidation.dto';

export type ProgressMemberRow = { shipmentId: string; role: 'source' | 'target' };

export type ProgressWorkItemRow = { shipmentId: string; batchId: string; status: string };
export type ProgressWaybillRow = { shipmentId: string; id: string; status: string; trackingNo: string | null };
export type ProgressReconcileRow = { shipmentId: string; gaveUpAt: Date | null; nextCheckAt: Date };

export function consolidationProgressSourceIds(members: ProgressMemberRow[]): string[] {
  return members
    .filter((member) => member.role === 'source')
    .map((member) => member.shipmentId)
    .sort();
}

/** 새 상자는 완료된 작업에서만 돌려준다. 막힘은 대기 중일 때 재개 판정에서 얻은 것만 넘긴다 */
export function buildConsolidationProgressResponse(input: {
  operation: { id: string; status: ShipmentOperationStatus };
  members: ProgressMemberRow[];
  blockers: Array<{ shipmentId: string; codes: string[] }>;
  workItems: ProgressWorkItemRow[];
  waybills: ProgressWaybillRow[];
  reconcileStates: ProgressReconcileRow[];
}): ConsolidationProgressResponseDto {
  const { operation, members, ...rows } = input;
  const target = members.find((member) => member.role === 'target');

  return {
    operationId: operation.id,
    status: operation.status,
    targetShipmentId: operation.status === 'completed' ? (target?.shipmentId ?? null) : null,
    sources: buildConsolidationProgressSources({ sourceIds: consolidationProgressSourceIds(members), ...rows }),
  };
}

/** 행 목록은 최근 것이 앞에 오게 넘긴다. 같은 원본의 행이 여럿이면 첫 행만 쓴다 */
export function buildConsolidationProgressSources(input: {
  sourceIds: string[];
  blockers: Array<{ shipmentId: string; codes: string[] }>;
  workItems: ProgressWorkItemRow[];
  waybills: ProgressWaybillRow[];
  reconcileStates: ProgressReconcileRow[];
}): ConsolidationProgressSourceDto[] {
  const workItems = firstByShipment(input.workItems);
  const waybills = firstByShipment(input.waybills);
  const states = firstByShipment(input.reconcileStates);

  const blockers = new Map<string, Set<string>>();
  for (const row of input.blockers) {
    const codes = blockers.get(row.shipmentId) ?? new Set<string>();
    row.codes.forEach((code) => codes.add(code));
    blockers.set(row.shipmentId, codes);
  }

  return input.sourceIds.map((shipmentId) => {
    const workItem = workItems.get(shipmentId);
    const waybill = waybills.get(shipmentId);
    const state = states.get(shipmentId);

    return {
      shipmentId,
      trackingNo: waybill?.trackingNo ?? null,
      batchId: workItem?.batchId ?? null,
      workItemStatus: workItem?.status ?? null,
      waybillId: waybill?.id ?? null,
      waybillStatus: waybill?.status ?? null,
      blockers: [...(blockers.get(shipmentId) ?? [])].sort(),
      gaveUpAt: state?.gaveUpAt?.toISOString() ?? null,
      nextCheckAt: state?.nextCheckAt.toISOString() ?? null,
    };
  });
}

function firstByShipment<T extends { shipmentId: string }>(rows: T[]): Map<string, T> {
  const result = new Map<string, T>();

  for (const row of rows) {
    if (!result.has(row.shipmentId)) result.set(row.shipmentId, row);
  }

  return result;
}
