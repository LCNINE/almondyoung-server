import { errorMessage } from '../../core/data/errorMessage';
import type { ReadyShipment } from '../inbound/readyShipments';
import {
  fetchJoinCandidates,
  joinBoxIntoBatch,
  type JoinCandidate,
  type JoinDeps,
  type JoinOutcome,
} from './batchJoin';

interface PlanResult {
  succeeded: string[];
  failed: Array<{ shipmentId: string; code: string; message: string; transient?: boolean }>;
}

/**
 * 입고로 갖춰진 상자를 고른 배치에 넣고 송장을 출력한다: (draft 면) 출고 계획 → 합류 후보 찾기 → 기존 합류·출력.
 * 이미 계획된 상자는 계획이 성공으로 돌아오므로 그대로 이어 간다.
 */
export async function printReadyShipmentIntoBatch(
  deps: JoinDeps,
  batchId: string,
  shipment: ReadyShipment,
): Promise<JoinOutcome> {
  if (shipment.status === 'draft') {
    try {
      const plan = await deps.api.request<PlanResult>({
        method: 'POST',
        path: '/outbound-preparation/plans',
        body: { shipmentIds: [shipment.shipmentId] },
        idempotencyKey: deps.newKey(),
      });
      if (!plan.succeeded.includes(shipment.shipmentId)) {
        const failure = plan.failed.find((f) => f.shipmentId === shipment.shipmentId) ?? plan.failed[0];
        return { kind: 'blocked', message: failure?.message ?? '출고 계획을 세우지 못했어요. 관리자에게 문의해 주세요.' };
      }
    } catch (error) {
      return { kind: 'blocked', message: errorMessage(error, 'outbound') };
    }
  }
  let candidate: JoinCandidate | undefined;
  try {
    const candidates = await fetchJoinCandidates(deps.api, batchId, shipment.orderNos[0]);
    candidate = candidates.find((c) => c.shipmentId === shipment.shipmentId);
  } catch (error) {
    return { kind: 'blocked', message: errorMessage(error, 'outbound') };
  }
  if (!candidate) return { kind: 'blocked', message: '이 상자를 배치에서 찾지 못했어요. 목록을 새로 고쳐 주세요.' };
  return joinBoxIntoBatch(deps, batchId, candidate);
}
